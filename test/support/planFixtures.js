// Drives the plugin's real, full planning pipeline (thisplugin.updateLayer()) against a fixed
// set of real portal coordinates, the same way IITC itself would once a polygon is drawn around
// them -- so "Less walking" (and anything else updateLayer() computes) is exercised through its
// actual entry point, not reimplemented or called out of context.

'use strict';

const fs = require('fs');
const path = require('path');

function loadFixturePortals(fixtureName) {
  const file = path.join(__dirname, '..', 'fixtures', fixtureName);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// window.portals[guid]: just enough of a real portal entity for findFanpoints/buildFanPlan to
// read a location and a title from (getLatLng(), options.data.title/resCount/team).
function buildWindowPortals(fixturePortals, L) {
  const portals = {};
  fixturePortals.forEach(function (p) {
    portals[p.guid] = {
      getLatLng() { return new L.LatLng(p.lat, p.lng); },
      options: { data: { title: p.title, team: 'RESISTANCE', resCount: 8 } }
    };
  });
  return portals;
}

// A rectangle comfortably around every fixture portal, in plain lat/lng -- what the plugin's
// own findFanpoints()/filterPolygon() read off a drawn DrawTools polygon via getLatLngs().
function buildBoundingPolygonLatLngs(fixturePortals, L, marginDeg) {
  marginDeg = marginDeg === undefined ? 0.01 : marginDeg;
  const lats = fixturePortals.map(function (p) { return p.lat; });
  const lngs = fixturePortals.map(function (p) { return p.lng; });
  const minLat = Math.min.apply(null, lats) - marginDeg;
  const maxLat = Math.max.apply(null, lats) + marginDeg;
  const minLng = Math.min.apply(null, lngs) - marginDeg;
  const maxLng = Math.max.apply(null, lngs) + marginDeg;
  return [
    new L.LatLng(minLat, minLng),
    new L.LatLng(minLat, maxLng),
    new L.LatLng(maxLat, maxLng),
    new L.LatLng(maxLat, minLng)
  ];
}

// Wires window.portals and a single-polygon DrawTools stand-in covering all of `fixturePortals`
// into the sandbox, and makes sure the plugin's own LatLng extensions (bearingToE6 etc., only
// ever applied by its real setup()) are in place -- everything updateLayer() itself expects to
// already exist before it runs, short of actually calling the real setup().
function wirePlanInputs(sandbox, fixturePortals) {
  const { thisplugin, window, L } = sandbox;
  thisplugin.initLatLng();
  thisplugin.debugLogPlan = false; // keep test output free of the plan dump this would otherwise print

  window.portals = buildWindowPortals(fixturePortals, L);
  window.links = {};
  sandbox.syncBareGlobals();

  const polygon = Object.create(L.GeodesicPolygon.prototype);
  polygon.getLatLngs = function () { return buildBoundingPolygonLatLngs(fixturePortals, L); };

  window.plugin.drawTools = {
    drawnItems: {
      _layers: {},
      getLayers() { return [polygon]; }
    }
  };

  thisplugin.linksLayerGroup = new L.LayerGroup();
  thisplugin.fieldsLayerGroup = new L.LayerGroup();
  thisplugin.numbersLayerGroup = new L.LayerGroup();
  thisplugin.excludedPortalMarkersLayerGroup = new L.LayerGroup();
}

// Runs the real plan for `fixturePortals`, in the given mode, anchored at `anchorGuid` (any
// fixture guid) with no SBUL and no manual tweaks -- then returns everything a "best possible
// walk order" test needs to check:
//  - fields / links: what the core algorithm itself built (anchor choice and mode only change
//    this through which links fit in without crossing each other -- "Less walking" never does);
//  - walkOrder: the actual walk order (fanpoints, anchor first) used for display/distance;
//  - totalWalkDistance: thisplugin.computeTotalWalkDistance() for that order.
async function buildPlan(fixturePortals, options) {
  options = options || {};
  const { createPluginSandbox } = require('./pluginSandbox');
  const sandbox = createPluginSandbox();
  const { thisplugin } = sandbox;

  wirePlanInputs(sandbox, fixturePortals);

  if (options.mode === 'outbound') {
    thisplugin.stardirection = thisplugin.starDirENUM.RADIATING;
    thisplugin.availableSBUL = options.availableSBUL === undefined ? 2 : options.availableSBUL;
  }
  if (options.clockwise === false) thisplugin.is_clockwise = false;

  // updateLayer() itself unconditionally console.logs a "=== Fan Fields ===" summary on every
  // call (several per buildPlan here, between the first pass, the link-order recompute and the
  // anchor pin) -- real console noise a test run has no use for, silenced for just this stretch.
  const realConsoleLog = console.log;
  console.log = function () {};
  try {
    thisplugin.updateLayer(); // first pass: populates thisplugin.fanpoints with a default (hull) anchor

    var anchorGuid = options.anchorGuid || thisplugin.perimeterpoints[thisplugin.startingpointIndex][0];
    thisplugin.setAnchorByGuid(anchorGuid); // pins it and recalculates -- same call the UI's own "Pick anchor" makes
  } finally {
    console.log = realConsoleLog;
  }

  // Outbound mode orders the walk ahead of the anchor against the player's own position
  // (thisplugin.orderPrefixForOutbound), fetched asynchronously (thisplugin.getPlayerPosition) --
  // in the sandbox this always falls back to "no GPS" (see pluginSandbox's navigator stub), but
  // still only AFTER a real tick, same as a browser's Geolocation API never answering
  // synchronously. Reading the walk order before that fallback lands would silently test the
  // un-optimized, bearing-sorted prefix instead of the real algorithm.
  if (options.mode === 'outbound') {
    await new Promise(function (resolve) { setTimeout(resolve, 20); });
  }

  return {
    sandbox,
    thisplugin,
    anchorGuid,
    sortedFanpoints: thisplugin.sortedFanpoints,
    donelinks: thisplugin.donelinks,
    triangles: thisplugin.triangles,
    centerKeys: thisplugin.centerKeys,
    walkOrder: thisplugin.getDisplayOrder(),
    totalWalkDistance: thisplugin.computeTotalWalkDistance()
  };
}

module.exports = {
  loadFixturePortals,
  buildWindowPortals,
  buildBoundingPolygonLatLngs,
  wirePlanInputs,
  buildPlan
};
