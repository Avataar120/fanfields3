// Runs the plugin's real planning pipeline for one fixture, in one mode, anchored at one named
// portal, and dumps everything a walk-order PDF report needs: the walk order itself, every link
// in the exact sequence it gets thrown (tagged with how many fields it completes), and every
// field (triangle) resolved to the three portal guids forming it, tagged with the walk step that
// completes it. generateWalkReportPdf.py turns this JSON into the actual report.
//
// Usage: node test/tools/exportWalkReport.js [fixtureFile] <anchorTitle> [mode] [outputJson]
//   fixtureFile  - name under test/fixtures/, default orly-76-portals.json
//   anchorTitle  - exact portal title to anchor on (required)
//   mode         - "inbound" (default) or "outbound"
//   outputJson   - output path, default test/tools/report_data.json

'use strict';

const path = require('path');
const fs = require('fs');
const { loadFixturePortals, wirePlanInputs } = require('../support/planFixtures');
const { createPluginSandbox } = require('../support/pluginSandbox');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node test/tools/exportWalkReport.js [fixtureFile] <anchorTitle> [mode] [outputJson]');
  process.exit(1);
}

// fixtureFile is optional -- treat the first arg as the anchor title unless it looks like a
// fixture filename (ends in .json) and a second arg is also given.
let fixtureFile = 'orly-76-portals.json';
let rest = args;
if (args[0].endsWith('.json') && args.length > 1) {
  fixtureFile = args[0];
  rest = args.slice(1);
}
const anchorTitle = rest[0];
const mode = rest[1] || 'inbound';
const outputJson = rest[2] || path.join(__dirname, 'report_data.json');

if (!anchorTitle) {
  console.error('Missing required <anchorTitle>.');
  process.exit(1);
}

function haversine(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

(async () => {
  const portals = loadFixturePortals(fixtureFile);
  const byGuid = {};
  portals.forEach((p) => { byGuid[p.guid] = p; });

  const anchor = portals.find((p) => p.title === anchorTitle);
  if (!anchor) {
    console.error('No portal titled "' + anchorTitle + '" in ' + fixtureFile);
    process.exit(1);
  }

  const sandbox = createPluginSandbox();
  const { thisplugin } = sandbox;
  wirePlanInputs(sandbox, portals);

  if (mode === 'outbound') {
    thisplugin.stardirection = thisplugin.starDirENUM.RADIATING;
    thisplugin.availableSBUL = 2;
  }

  const realLog = console.log;
  console.log = function () {};
  thisplugin.updateLayer();
  thisplugin.setAnchorByGuid(anchor.guid);
  console.log = realLog;

  // Outbound orders the walk ahead of the anchor against the player's own position, resolved
  // asynchronously (falls back to "no GPS" here, same as a browser's Geolocation API never
  // answering synchronously) -- see planFixtures.buildPlan for the same wait.
  if (mode === 'outbound') {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  const order = thisplugin.getDisplayOrder();

  // point.x = lng, point.y = lat (see buildWindowPortals / L.LatLng usage throughout the plugin).
  function findGuidByPoint(pt) {
    for (const p of portals) {
      if (Math.abs(p.lat - pt.y) < 1e-6 && Math.abs(p.lng - pt.x) < 1e-6) return p.guid;
    }
    return null;
  }

  // Built first without newFields: the plugin's own per-portal outgoingMeta.fieldsCreatedValid
  // is cumulative only within that one portal's own throw sequence, not a reliable global
  // per-link count (it can even go backwards from one link to the next at the same portal) --
  // newFields is filled in below from an independent, globally-consistent computation instead.
  const linkSeq = [];
  order.forEach((fp, stepIndex) => {
    (fp.outgoing || []).forEach((targetFp) => {
      linkSeq.push({ srcGuid: fp.guid, dstGuid: targetFp.guid, stepIndex, newFields: 0 });
    });
  });

  const edgeKey = (a, b) => [a, b].sort().join('|');
  const triangleGuids = thisplugin.triangles
    .map((t) => [findGuidByPoint(t.a), findGuidByPoint(t.b), findGuidByPoint(t.c)])
    .filter((t) => t.every((g) => g));

  // Index by edge, in overall throw order (not just stepIndex -- several links can share a
  // step), so a triangle whose 3 edges are thrown across different steps, or even at the same
  // step, is attributed to the one link that genuinely completes it last.
  const linkIndexByEdge = {};
  linkSeq.forEach((l, idx) => { linkIndexByEdge[edgeKey(l.srcGuid, l.dstGuid)] = idx; });

  const fieldCompletionStep = triangleGuids.map(([a, b, c]) => {
    const edgeLinkIdx = [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)].map((k) => linkIndexByEdge[k]);
    if (edgeLinkIdx.some((idx) => idx === undefined)) return null;
    const completingLinkIdx = Math.max(...edgeLinkIdx);
    linkSeq[completingLinkIdx].newFields += 1; // attribute this field to the link that completes it
    return linkSeq[completingLinkIdx].stepIndex;
  });

  let cumulativeDist = 0;
  const steps = order.map((fp, i) => {
    const prevFp = order[i - 1];
    const distFromPrev = prevFp ? haversine(byGuid[prevFp.guid], byGuid[fp.guid]) : 0;
    cumulativeDist += distFromPrev;
    const linksHere = linkSeq
      .filter((l) => l.stepIndex === i)
      .map((l) => ({ destGuid: l.dstGuid, destTitle: byGuid[l.dstGuid].title, newFields: l.newFields }));
    return {
      guid: fp.guid,
      title: byGuid[fp.guid].title,
      lat: byGuid[fp.guid].lat,
      lng: byGuid[fp.guid].lng,
      distFromPrev,
      cumulativeDist,
      links: linksHere
    };
  });

  const output = {
    fixtureFile,
    anchorTitle,
    mode,
    portals: portals.map((p) => ({ guid: p.guid, title: p.title, lat: p.lat, lng: p.lng })),
    steps,
    linkSeq,
    triangleGuids,
    fieldCompletionStep,
    totalWalkDistance: cumulativeDist
  };

  fs.writeFileSync(outputJson, JSON.stringify(output));
  console.log(
    'Exported to ' + outputJson + ' -- steps:', steps.length,
    'links:', linkSeq.length,
    'fields:', triangleGuids.length,
    '(unmatched:', thisplugin.triangles.length - triangleGuids.length, ')'
  );
  process.exit(0);
})();
