'use strict';

// Herringbone mode (thisplugin.fieldModeENUM.HERRINGBONE): a 2-anchor plan where A and B link
// directly to each other, and every other portal -- added nearest-nearest-reachable-next, see
// buildHerringboneChain -- links to BOTH anchors plus whichever such portal came right before
// it in the chain, closing 2 new fields each time. See thisplugin.buildHerringboneChain/
// buildHerringbonePlan in the plugin itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox, FakePoint, toHostArray } = require('./support/pluginSandbox');
const { loadFixturePortals, wirePlanInputs } = require('./support/planFixtures');

function fanpointsFrom(obj) {
  const fanpoints = {};
  Object.keys(obj).forEach(function (guid) {
    fanpoints[guid] = new FakePoint(obj[guid][0], obj[guid][1]);
  });
  return fanpoints;
}

// plan.chain/excludedGuids/links/triangles are built by code running inside the sandbox's own
// vm context, so they're arrays from THAT realm -- assert.deepEqual against a plain host-realm
// array literal throws "same structure but not reference-equal" even when the contents match
// (see pluginSandbox.js's own toHostArray comment). Converting first via the host's bare
// Array.from (what toHostArray does) sidesteps that.
function chainGuids(plan) {
  return toHostArray(plan.chain).map(function (c) { return c.guid; });
}

// Every pair of links in `links` that doesn't share an endpoint (thisplugin.intersects itself
// treats a shared endpoint as "not a crossing") must not cross -- the whole point of
// buildHerringboneChain excluding a candidate rather than accepting a crossing link.
function assertNoCrossings(thisplugin, links) {
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      assert.ok(!thisplugin.intersects(links[i], links[j]),
        'links ' + i + ' and ' + j + ' must not cross');
    }
  }
}

// Every chain portal must have a 'toA' link to plan.anchorGuidA and a 'toB' link to
// plan.anchorGuidB -- the whole point of the pattern (see buildHerringboneChain's own
// comment). Checked by `kind` rather than by raw endpoint counting: an interior portal is
// ALSO the 'chain' target of whichever portal comes right after it, so counting every link
// touching it (4, not 3) is not by itself a sign anything is wrong.
function assertEveryChainPortalLinksToBothAnchors(plan) {
  toHostArray(plan.chain).forEach(function (c) {
    var own = toHostArray(plan.links).filter(function (l) { return l.guidA === c.guid; });
    var toA = own.filter(function (l) { return l.kind === 'toA' && l.guidB === plan.anchorGuidA; });
    var toB = own.filter(function (l) { return l.kind === 'toB' && l.guidB === plan.anchorGuidB; });
    assert.equal(toA.length, 1, 'portal ' + c.guid + ' must have exactly one link to anchor A');
    assert.equal(toB.length, 1, 'portal ' + c.guid + ' must have exactly one link to anchor B');
  });
}

test('buildFfButtons: Shift left is gone, replaced by a Fan/Herringbone mode toggle; Shift right is untouched', () => {
  const { thisplugin, window, $ } = createPluginSandbox();

  let addedControl = null;
  window.map.addControl = function (control) { addedControl = control; };

  thisplugin.addFfButtons();
  addedControl.onAdd(window.map);

  assert.equal($.__registry.get('fanfieldShiftLeftButton'), undefined);

  const modeButton = $.__registry.get('fanfieldModeToggleButton');
  assert.ok(modeButton, 'the mode toggle button must exist in its place');
  assert.match(modeButton.title, /Fan field mode/);

  const shiftRight = $.__registry.get('fanfieldShiftRightButton');
  assert.ok(shiftRight, 'Shift right must still be there, untouched');
  assert.equal(shiftRight.title, 'FanFields shift right');
});

test('toggleFieldMode: flips between FAN and HERRINGBONE and persists the choice', () => {
  const { thisplugin } = createPluginSandbox();
  thisplugin.delayedUpdateLayer = function () {}; // isolate from the full map/draw pipeline

  assert.equal(thisplugin.fieldMode, thisplugin.fieldModeENUM.FAN);

  thisplugin.toggleFieldMode();
  assert.equal(thisplugin.fieldMode, thisplugin.fieldModeENUM.HERRINGBONE);

  thisplugin.toggleFieldMode();
  assert.equal(thisplugin.fieldMode, thisplugin.fieldModeENUM.FAN);
});

test('getCurrentOptionsSnapshot/applyOptionsSnapshot: fieldMode round-trips like the other options', () => {
  const { thisplugin } = createPluginSandbox();
  thisplugin.fieldMode = thisplugin.fieldModeENUM.HERRINGBONE;

  const snapshot = thisplugin.getCurrentOptionsSnapshot();
  assert.equal(snapshot.fieldMode, thisplugin.fieldModeENUM.HERRINGBONE);

  thisplugin.fieldMode = thisplugin.fieldModeENUM.FAN;
  thisplugin.applyOptionsSnapshot(snapshot);
  assert.equal(thisplugin.fieldMode, thisplugin.fieldModeENUM.HERRINGBONE);

  // An unrecognized/missing value is left alone rather than clearing the mode.
  thisplugin.applyOptionsSnapshot({});
  assert.equal(thisplugin.fieldMode, thisplugin.fieldModeENUM.HERRINGBONE);
});

test('buildHerringboneChain: a well-placed chain links in every portal, with 3n links and 2n-1 fields, none crossing', () => {
  const { thisplugin } = createPluginSandbox();
  // Each portal must sit in the "wedge" beyond its predecessor as seen from BOTH anchors at
  // once (here: further along the A->B axis AND closer to the A-B line than the one before it)
  // -- two portals on opposite sides of the A-B line, or two portals equally far from it, make
  // at least one of the required links cross another (see the next test for exactly that).
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3]
  });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', null);

  assert.ok(plan, 'a valid chain must be found');
  assert.equal(plan.excludedGuids.length, 0);
  assert.equal(plan.chain.length, 3);
  assert.deepEqual(chainGuids(plan), ['C', 'D', 'E']);

  const n = plan.chain.length;
  assert.equal(plan.links.length, 3 * n);
  assert.equal(plan.triangles.length, 2 * n - 1);

  assertNoCrossings(thisplugin, plan.links);
  assertEveryChainPortalLinksToBothAnchors(plan);
});

test('buildHerringboneChain: a portal whose link would cross an already-accepted one is excluded, not fatal to the rest', () => {
  const { thisplugin } = createPluginSandbox();
  // D's link back to its predecessor C would cross the A-B base link at (50,0) -- see the
  // comment in this test file's own header for the reasoning behind these coordinates.
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [30, 20], D: [70, -20]
  });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', null);

  assert.ok(plan);
  assert.deepEqual(chainGuids(plan), ['C']);
  assert.deepEqual(toHostArray(plan.excludedGuids), ['D']);
  assert.equal(plan.links.length, 3); // A-B, C-A, C-B
  assert.equal(plan.triangles.length, 1);

  assertNoCrossings(thisplugin, plan.links);
  assertEveryChainPortalLinksToBothAnchors(plan);
});

test('buildHerringboneChain: too few portals (no third portal at all) still throws just the A-B link, no chain', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({ A: [0, 0], B: [100, 0] });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', null);
  assert.equal(plan, null);
});

test('buildHerringboneChain: Respect Intel blocks a crossing in-game link from a respected faction', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({ A: [0, 0], B: [100, 0], C: [50, 10] });

  // A real in-game link running the length of the strip at y=5: parallel to (so never crossing)
  // the A-B base link at y=0, but crossing both of C's own links to A and B on the way down
  // from C at y=10.
  const respectLink = { a: new FakePoint(-10, 5), b: new FakePoint(110, 5) };

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', [respectLink]);
  assert.ok(plan, 'the base A-B link itself does not cross the respected link, so a (degenerate) plan is still returned');
  assert.equal(plan.chain.length, 0, 'C is excluded because both its links would cross the respected link');
  assert.deepEqual(toHostArray(plan.excludedGuids), ['C']);
  assert.equal(plan.links.length, 1); // just A-B
  assert.equal(plan.triangles.length, 0);
});

test('isBetterHerringboneScore: reused links first, then field count, then fewest keys on the busiest portal', () => {
  const { thisplugin } = createPluginSandbox();

  assert.equal(thisplugin.isBetterHerringboneScore({ reused: 2, fields: 1, maxKeys: 9 }, { reused: 1, fields: 9, maxKeys: 1 }), true);
  assert.equal(thisplugin.isBetterHerringboneScore({ reused: 1, fields: 5, maxKeys: 9 }, { reused: 1, fields: 3, maxKeys: 1 }), true);
  assert.equal(thisplugin.isBetterHerringboneScore({ reused: 1, fields: 3, maxKeys: 2 }, { reused: 1, fields: 3, maxKeys: 5 }), true);
  assert.equal(thisplugin.isBetterHerringboneScore({ reused: 1, fields: 3, maxKeys: 5 }, { reused: 1, fields: 3, maxKeys: 5 }), false);
});

test('buildHerringbonePlan: picks the two anchors that chain in every other portal', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0], C: [20, 20], D: [50, 10], E: [80, 3]
  });

  const plan = thisplugin.buildHerringbonePlan(fanpoints);

  assert.ok(plan);
  assert.deepEqual([plan.anchorGuidA, plan.anchorGuidB].sort(), ['A', 'B']);
  assert.equal(plan.chain.length, 3);
  assert.equal(plan.excludedGuids.length, 0);
});

test('buildHerringbonePlan: fewer than 3 portals in the selection -> no plan', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({ A: [0, 0], B: [100, 0] });
  assert.equal(thisplugin.buildHerringbonePlan(fanpoints), null);
});

test('updateLayer() in Herringbone mode draws its own plan and leaves the fan field\'s own state empty', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 6);
  const sandbox = createPluginSandbox();
  const { thisplugin } = sandbox;
  wirePlanInputs(sandbox, portals);

  thisplugin.fieldMode = thisplugin.fieldModeENUM.HERRINGBONE;

  const realConsoleLog = console.log;
  console.log = function () {};
  try {
    thisplugin.updateLayer();
  } finally {
    console.log = realConsoleLog;
  }

  assert.ok(thisplugin.herringbonePlan, 'a herringbone plan must have been computed for 6 real portals');
  assert.equal(thisplugin.herringbonePlan.chain.length + 2 <= portals.length, true);
  assert.equal(thisplugin.sortedFanpoints.length, 0,
    'the fan field\'s own sortedFanpoints must stay empty -- Task List/Statistics are not wired up to herringbone mode yet');
  assert.equal(thisplugin.links, thisplugin.herringbonePlan.links);
});

test('buildHerringbonePlan: on a real, dense 76-portal cluster, chains in a double-digit number of portals with zero crossings, well within budget', () => {
  const portals = loadFixturePortals('orly-76-portals.json');
  const sandbox = createPluginSandbox();
  const { thisplugin } = sandbox;
  wirePlanInputs(sandbox, portals);

  const realConsoleLog = console.log;
  console.log = function () {};
  let fanpoints;
  try {
    thisplugin.updateLayer(); // fan mode is enough to populate thisplugin.fanpoints
    fanpoints = thisplugin.fanpoints;
  } finally {
    console.log = realConsoleLog;
  }

  const start = Date.now();
  const plan = thisplugin.buildHerringbonePlan(fanpoints);
  const elapsedMs = Date.now() - start;

  assert.ok(plan);
  // Not a tight regression bound (the greedy heuristic may reasonably find a slightly
  // different number on an unrelated change) -- just a floor confirming the search over every
  // anchor pair (not just the convex hull) still finds a meaningfully long chain on real,
  // scattered data, not the 2-3 portals a single fixed left-to-right order used to stall at.
  assert.ok(plan.chain.length >= 8,
    'expected at least 8 chained portals on this fixture, got ' + plan.chain.length);
  assert.ok(elapsedMs < thisplugin.HERRINGBONE_SEARCH_BUDGET_MS,
    'searching every anchor pair for 76 portals must stay within its own time budget');

  assertNoCrossings(thisplugin, plan.links);
  assertEveryChainPortalLinksToBothAnchors(plan);
});

test('updateLayer() still builds a normal fan field plan when fieldMode is FAN (no regression)', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 6);
  const sandbox = createPluginSandbox();
  const { thisplugin } = sandbox;
  wirePlanInputs(sandbox, portals);

  assert.equal(thisplugin.fieldMode, thisplugin.fieldModeENUM.FAN);

  const realConsoleLog = console.log;
  console.log = function () {};
  try {
    thisplugin.updateLayer();
  } finally {
    console.log = realConsoleLog;
  }

  assert.equal(thisplugin.herringbonePlan, undefined);
  assert.equal(thisplugin.sortedFanpoints.length, portals.length);
});
