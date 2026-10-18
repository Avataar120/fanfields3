'use strict';

// Herringbone mode (thisplugin.fieldModeENUM.HERRINGBONE): a 2-anchor plan where A and B link
// directly to each other, and every other portal -- added nearest-nearest-reachable-next, see
// buildHerringboneChain -- links to BOTH anchors plus whichever such portal came right before
// it in the chain, closing 2 new fields each time. See thisplugin.buildHerringboneChain/
// buildHerringbonePlan in the plugin itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox, FakePoint, FakeLatLng, toHostArray } = require('./support/pluginSandbox');
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

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', { respectLinks: [respectLink] });
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

// Runs the real herringbone pipeline (wirePlanInputs + updateLayer() in HERRINGBONE mode) for
// `portals`, the same way updateLayer() itself drives it once a polygon is drawn -- used by
// every test below that needs a real, non-trivial plan rather than a hand-built one.
function buildHerringboneForFixture(portals) {
  const sandbox = createPluginSandbox();
  const { thisplugin } = sandbox;
  wirePlanInputs(sandbox, portals);
  thisplugin.fieldMode = thisplugin.fieldModeENUM.HERRINGBONE;
  // thisplugin._mapDataLoading defaults to true (real IITC only clears it via its own
  // mapDataRefreshEnd hook, wired up in setup() -- not called here); lockIfPlanComplete()
  // otherwise refuses to lock a plan it still thinks the map is loading for.
  thisplugin._mapDataLoading = false;

  const realConsoleLog = console.log;
  console.log = function () {};
  try {
    thisplugin.updateLayer();
  } finally {
    console.log = realConsoleLog;
  }

  return sandbox;
}

test('updateLayer() in Herringbone mode now also populates the shared plan state (Task List/Statistics/Manage Portal Order)', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 6);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin } = sandbox;

  assert.ok(thisplugin.herringbonePlan, 'a herringbone plan must have been computed for 6 real portals');
  const plan = thisplugin.herringbonePlan;
  assert.equal(thisplugin.herringbonePlan.chain.length + 2 <= portals.length, true);
  assert.equal(thisplugin.links, plan.links);
  assert.equal(thisplugin.donelinks, plan.links);
  assert.equal(thisplugin.triangles, plan.triangles);

  // sortedFanpoints is now populated, in walk order [anchor B, anchor A, chain...] -- anchor B
  // receives the base link (A throws to B), so it must be visited/keyed first; see
  // buildHerringboneFanpoints's own comment for why.
  assert.equal(thisplugin.sortedFanpoints.length, plan.chain.length + 2);
  const walkGuids = toHostArray(thisplugin.sortedFanpoints).map(function (fp) { return fp.guid; });
  assert.deepEqual(walkGuids, [plan.anchorGuidB, plan.anchorGuidA].concat(chainGuids(plan)));

  // A complete plan locks itself, same as the fan field does, instead of recalculating on
  // every pan/zoom.
  assert.equal(thisplugin.is_locked, true);
});

test('buildHerringboneFanpoints: converts a plan into the shared sortedFanpoints shape, with the right precedence and field crediting', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3]
  });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', null);
  const converted = thisplugin.buildHerringboneFanpoints(plan);

  const order = toHostArray(converted.sortedFanpoints);
  assert.deepEqual(order.map(function (fp) { return fp.guid; }), ['B', 'A', 'C', 'D', 'E']);
  assert.equal(converted.n, plan.chain.length + 2);

  const byGuid = {};
  order.forEach(function (fp) { byGuid[fp.guid] = fp; });

  function outgoingGuids(guid) {
    return toHostArray(byGuid[guid].outgoing).map(function (fp) { return fp.guid; }).sort();
  }

  // Base link: A throws to B (needs B's key already) -- B is visited first, A never throws.
  // B also receives every chain portal's own "toB" link, same as A receives their "toA" --
  // that's what makes B the busiest portal (n+1 incoming vs. A's n).
  assert.deepEqual(outgoingGuids('A'), ['B']);
  assert.deepEqual(toHostArray(byGuid.B.incoming).map(function (fp) { return fp.guid; }).sort(),
    ['A', 'C', 'D', 'E']);
  assert.equal(byGuid.B.outgoing.length, 0, 'an anchor never throws in this plan, only receives');

  // Every chain portal throws to both anchors, plus (for all but the first) its predecessor.
  assert.deepEqual(outgoingGuids('C'), ['A', 'B']);
  assert.deepEqual(outgoingGuids('D'), ['A', 'B', 'C']);
  assert.deepEqual(outgoingGuids('E'), ['A', 'B', 'D']);

  // Running the walk order through simulateWalk must reproduce exactly plan.triangles.length
  // fields -- each triangle's creatingFieldsWith annotation (attached to just one of its 3
  // sides) must fan out correctly to credit every one of them, with no link invalidated.
  const sim = thisplugin.simulateWalk(order);
  assert.equal(sim.triangles.length, plan.triangles.length);
  assert.equal(Object.keys(sim.invalid).length, 0, 'none of these short links should be invalid-under-field');
});

test('buildTaskListHTML: renders a Herringbone plan\'s anchors and chain, without the inert per-link flip button', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 7);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin } = sandbox;
  const plan = thisplugin.herringbonePlan;
  assert.ok(plan, 'a plan must have been found for this fixture slice');

  const html = thisplugin.buildTaskListHTML();

  toHostArray(thisplugin.sortedFanpoints).forEach(function (fp) {
    assert.ok(html.includes('plugin_fanfields3_exportText_' + fp.guid),
      'every walk portal (both anchors and the chain) must get its own Task List row');
  });
  assert.ok(!html.includes('plugin_fanfields3_link_flip_btn'),
    'the manual flip button has no effect on a Herringbone plan\'s own build and must not be shown');
  assert.ok(html.includes('plugin_fanfields3_reset_link_flips_btn'),
    '"Reset link orders" stays -- it can still undo a Reroute order');
});

test('buildStatisticsHTML: shows a computed Herringbone plan instead of "No Fanfield plan calculated yet"', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 7);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin } = sandbox;

  const html = thisplugin.buildStatisticsHTML();

  assert.ok(!html.includes('No Fanfield plan calculated yet'));
  assert.ok(html.includes(String(thisplugin.donelinks.length)), 'the link count must come from the herringbone plan');
});

test('buildManageOrderTableHTML: shows both anchors (fixed, labelled individually) and no manual reordering for Herringbone', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 7);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin } = sandbox;
  const plan = thisplugin.herringbonePlan;
  assert.ok(plan && plan.chain.length >= 1, 'this fixture slice must produce at least one chain portal');

  const html = thisplugin.buildManageOrderTableHTML();

  assert.ok(html.includes('(anchor A)'));
  assert.ok(html.includes('(anchor B)'));
  assert.equal((html.match(/plugin_fanfields3_order_anchor_icon/g) || []).length, 2,
    'exactly the 2 anchor rows get the pinned-row icon');
  assert.ok(!html.includes('plugin_fanfields3_order_handle'),
    'no drag handle -- Herringbone has no manual reordering yet');
  assert.ok(!html.includes('plugin_fanfields3_order_move_up'),
    'no mobile move buttons either');
  assert.ok(!html.includes('id="plugin_fanfields3_order_apply"'),
    'Apply would silently do nothing for a Herringbone plan, so it must not be offered');
  assert.ok(html.includes('id="plugin_fanfields3_order_reset"'), 'Reset stays (undoes a Reroute order)');
  assert.ok(html.includes('id="plugin_fanfields3_order_path"'), 'Path stays (just previews the walk order)');
  assert.ok(html.includes('Manual reordering isn\'t available yet in Herringbone mode'));
});

test('computeBlockerPlan: tolerates a Herringbone plan and flags a link crossing it as a blocker', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 7);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin, window } = sandbox;
  const plan = thisplugin.herringbonePlan;
  assert.ok(plan, 'a plan must have been found for this fixture slice');

  const baseLink = toHostArray(plan.links).filter(function (l) { return l.kind === 'base'; })[0];
  assert.ok(baseLink, 'a herringbone plan always has its own base (anchor-to-anchor) link');

  // A segment perpendicular to, and centered on, the base link's own midpoint -- guaranteed to
  // cross it (not just share an endpoint, which thisplugin.intersects treats as "not crossing").
  const dx = baseLink.b.x - baseLink.a.x;
  const dy = baseLink.b.y - baseLink.a.y;
  const midX = (baseLink.a.x + baseLink.b.x) / 2;
  const midY = (baseLink.a.y + baseLink.b.y) / 2;
  const p1 = new FakePoint(midX - dy * 0.1, midY + dx * 0.1);
  const p2 = new FakePoint(midX + dy * 0.1, midY - dx * 0.1);

  window.links['test-crossing-blocker'] = {
    getLatLngs() { return [window.map.unproject(p1, 17), window.map.unproject(p2, 17)]; },
    options: { team: window.TEAM_ENL, data: { oGuid: 'blockerPortalA', dGuid: 'blockerPortalB' } }
  };
  // Rebuild thisplugin.intelLinks/locations from the live window.links/portals, same as a
  // real in-game data refresh would -- without recalculating the plan itself.
  thisplugin.refreshLiveGameData();

  const blockerPlan = thisplugin.computeBlockerPlan();

  assert.ok(blockerPlan.blockers.length >= 1, 'the crossing link must be detected as a blocker');
  assert.ok(Array.isArray(blockerPlan.stops));
  assert.ok(typeof blockerPlan.extraDistance === 'number');
});

test('computeRouteOrder: produces a valid reordering (every walk guid exactly once) of a Herringbone plan', () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 7);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin } = sandbox;

  const walkGuids = toHostArray(thisplugin.sortedFanpoints).map(function (fp) { return fp.guid; });
  const result = thisplugin.computeRouteOrder(new FakeLatLng(0, 0));

  assert.ok(result, 'everything is still pending in a fresh sandbox (nothing captured/keyed yet)');
  assert.equal(result.order.length, walkGuids.length);
  assert.deepEqual(toHostArray(result.order).slice().sort(), walkGuids.slice().sort(),
    'the reordering is a permutation of the exact same walk, nothing added or dropped');
});

test('rerouteFromPlayerPosition: completes and redraws a Herringbone plan without throwing', async () => {
  const portals = loadFixturePortals('orly-76-portals.json').slice(0, 7);
  const sandbox = buildHerringboneForFixture(portals);
  const { thisplugin } = sandbox;

  await new Promise(function (resolve) {
    thisplugin.rerouteFromPlayerPosition(resolve);
  });

  assert.ok(thisplugin.routeOrderGuids, 'a Reroute order must have been computed and kept');
  assert.equal(thisplugin.routeOrderGuids.length, thisplugin.sortedFanpoints.length);
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

test('getCurrentOptionsSnapshot/applyOptionsSnapshot: herringboneMode/herringboneSide round-trip like fieldMode', () => {
  const { thisplugin } = createPluginSandbox();
  thisplugin.herringboneMode = thisplugin.herringboneModeENUM.OUTBOUND;
  thisplugin.herringboneSide = thisplugin.herringboneSideENUM.ONE_SIDE;

  const snapshot = thisplugin.getCurrentOptionsSnapshot();
  assert.equal(snapshot.herringboneMode, thisplugin.herringboneModeENUM.OUTBOUND);
  assert.equal(snapshot.herringboneSide, thisplugin.herringboneSideENUM.ONE_SIDE);

  thisplugin.herringboneMode = thisplugin.herringboneModeENUM.INBOUND;
  thisplugin.herringboneSide = thisplugin.herringboneSideENUM.BOTH_SIDE;
  thisplugin.applyOptionsSnapshot(snapshot);
  assert.equal(thisplugin.herringboneMode, thisplugin.herringboneModeENUM.OUTBOUND);
  assert.equal(thisplugin.herringboneSide, thisplugin.herringboneSideENUM.ONE_SIDE);

  // An unrecognized/missing value is left alone rather than resetting to the default.
  thisplugin.applyOptionsSnapshot({});
  assert.equal(thisplugin.herringboneMode, thisplugin.herringboneModeENUM.OUTBOUND);
  assert.equal(thisplugin.herringboneSide, thisplugin.herringboneSideENUM.ONE_SIDE);
});

test('buildHerringboneChain: oneSide keeps only the majority side of the anchor A-B line, excluding the rest', () => {
  const { thisplugin } = createPluginSandbox();
  // 3 portals on one side of the A-B line, 1 lone portal on the other -- the majority side must
  // win and the lone portal must be excluded by the pre-filter itself, regardless of which side
  // (positive or negative cross-product) happens to hold the majority.
  const majorityAbove = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3],
    F: [40, -15]
  });
  const above = thisplugin.buildHerringboneChain(majorityAbove, 'A', 'B', { oneSide: true });
  assert.ok(above);
  assert.deepEqual(chainGuids(above), ['C', 'D', 'E']);
  assert.deepEqual(toHostArray(above.excludedGuids), ['F']);

  // Mirrored: majority now below the line, lone candidate above it.
  const majorityBelow = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, -20], D: [50, -10], E: [80, -3],
    F: [40, 15]
  });
  const below = thisplugin.buildHerringboneChain(majorityBelow, 'A', 'B', { oneSide: true });
  assert.ok(below);
  assert.deepEqual(chainGuids(below), ['C', 'D', 'E']);
  assert.deepEqual(toHostArray(below.excludedGuids), ['F']);
});

test('buildHerringboneChain: outbound caps the chain at each anchor\'s own SBUL-derived outgoing capacity', () => {
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

  const inboundPlan = thisplugin.buildHerringbonePlan(fanpoints, { mode: thisplugin.herringboneModeENUM.INBOUND });
  assert.ok(inboundPlan.chain.length > 7,
    'the fixture must give inbound (no capacity concern) a chain longer than the cap tested below');

  thisplugin.availableSBUL = 0; // maxLinks = 8 -> cap = maxLinks - 1 = 7 (see the base link to B)
  const totalCandidates = Object.keys(fanpoints).length - 2;
  // Same anchor pair inbound already found works with, so this isolates the capacity cap
  // itself from the pair-search possibly also preferring a different (already short) pair.
  const outbound = thisplugin.buildHerringboneChain(fanpoints, inboundPlan.anchorGuidA, inboundPlan.anchorGuidB, { outbound: true });
  assert.ok(outbound);
  assert.equal(outbound.chain.length, 7, 'outbound stops once B would need its own 8th outgoing link (base link + 7 chain)');
  assert.equal(outbound.excludedGuids.length, totalCandidates - 7);
});

test('buildHerringboneFanpoints: outbound reverses every link direction and walks the chain newest-to-oldest', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3]
  });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', { outbound: true });
  const converted = thisplugin.buildHerringboneFanpoints(plan);

  const order = toHostArray(converted.sortedFanpoints);
  assert.deepEqual(order.map(function (fp) { return fp.guid; }), ['E', 'D', 'C', 'A', 'B'],
    'chain newest-to-oldest, then anchor A, then anchor B (A needs no one\'s key but its own target\'s; B needs A\'s too)');

  const byGuid = {};
  order.forEach(function (fp) { byGuid[fp.guid] = fp; });
  function outgoingGuids(guid) {
    return toHostArray(byGuid[guid].outgoing).map(function (fp) { return fp.guid; }).sort();
  }

  // Base link reversed: B throws to A (needs A's key) -- A is the only thing B needs that
  // isn't already in the chain.
  assert.deepEqual(toHostArray(byGuid.A.incoming).map(function (fp) { return fp.guid; }), ['B'],
    'A only ever receives the reversed base link, from B');

  // Both anchors throw OUT to every chain portal; the chain edge is reversed too (predecessor
  // throws to successor, so each chain portal still only needs its own predecessor's key).
  assert.deepEqual(outgoingGuids('A'), ['C', 'D', 'E']);
  assert.deepEqual(outgoingGuids('B'), ['A', 'C', 'D', 'E'].sort());
  assert.deepEqual(outgoingGuids('C'), ['D']);
  assert.deepEqual(outgoingGuids('D'), ['E']);
  assert.equal(byGuid.E.outgoing.length, 0, 'the newest chain portal throws nothing onward');

  // Fields must still all form correctly in this reversed walk order -- same invariant as the
  // inbound conversion test, just walked back to front.
  const sim = thisplugin.simulateWalk(order);
  assert.equal(sim.triangles.length, plan.triangles.length);
  assert.equal(Object.keys(sim.invalid).length, 0);
});

// Regression for the real-game mismatch reported against Fresque de l'écomobilité (Antibes,
// 2026-10-18 session, Outbound Herringbone): the Task List starred most of that anchor's own
// links with 2 fields each, but the intel log showed only 1 Control Field message right after
// almost every one of them -- only a few really closed 2 at once. Root cause: in outbound mode
// the chain link (predecessor -> successor) is always thrown FIRST, well before either anchor
// has thrown anything, so it can never be the link that completes a triangle -- yet
// buildHerringboneFanpoints used to annotate it with both anchors as third points (as if it were
// the inbound chain link, which genuinely does close 2 fields at once, see the fanpointsFrom test
// above with `{}` / no `outbound`). The two real closing links are each anchor's OWN link to that
// chain portal, each completing exactly one of the two triangles, never both.
test('buildHerringboneFanpoints: outbound annotates each triangle on the link that ACTUALLY completes it, not the chain link that is always thrown first', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3]
  });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', { outbound: true });
  const converted = thisplugin.buildHerringboneFanpoints(plan);
  const order = toHostArray(converted.sortedFanpoints);
  const chainGuidsInOrder = chainGuids(plan); // ['C', 'D', 'E']
  assert.ok(chainGuidsInOrder.length >= 3, 'this fixture must chain in enough portals to cover both the first and a later chain step');

  const byGuid = {};
  order.forEach(function (fp) { byGuid[fp.guid] = fp; });
  function rawCount(fromGuid, toGuid) {
    return byGuid[fromGuid].outgoingMeta[toGuid].creatingFieldsWith.length;
  }

  // The chain-to-chain links (thrown first, before either anchor has thrown anything at all)
  // must never claim to close a field -- they structurally can't, in outbound mode.
  for (let i = 1; i < chainGuidsInOrder.length; i++) {
    assert.equal(rawCount(chainGuidsInOrder[i - 1], chainGuidsInOrder[i]), 0,
      'chain link ' + chainGuidsInOrder[i - 1] + '->' + chainGuidsInOrder[i] + ' must not claim any field');
  }
  // Nor does the base link (B -> A, thrown before B reaches any chain portal).
  assert.equal(rawCount(plan.anchorGuidB, plan.anchorGuidA), 0);

  // The very first chain portal: only anchor B's own link to it closes a field (the A-B-chain0
  // triangle); anchor A's own link to it closes nothing (thrown before the base link even exists).
  assert.equal(rawCount(plan.anchorGuidA, chainGuidsInOrder[0]), 0);
  assert.equal(rawCount(plan.anchorGuidB, chainGuidsInOrder[0]), 1);

  // Every later chain portal: BOTH anchors' own links to it each close exactly one field (never
  // two at once on a single link) -- this is the exact pattern the real game log showed.
  for (let i = 1; i < chainGuidsInOrder.length; i++) {
    assert.equal(rawCount(plan.anchorGuidA, chainGuidsInOrder[i]), 1,
      'anchor A\'s own link to chain portal ' + i + ' must close exactly 1 field, not 2');
    assert.equal(rawCount(plan.anchorGuidB, chainGuidsInOrder[i]), 1,
      'anchor B\'s own link to chain portal ' + i + ' must close exactly 1 field, not 2');
  }

  // The raw annotation must match reality on its own, without depending on simulateWalk's
  // "credit whichever side is actually thrown last" fallback -- every directed link's raw count
  // must already equal what simulateWalk independently computes for it.
  const sim = thisplugin.simulateWalk(order);
  order.forEach(function (fp) {
    toHostArray(fp.outgoing).forEach(function (target) {
      const dkey = thisplugin.getDirectedLinkKey(fp.guid, target.guid);
      assert.equal(rawCount(fp.guid, target.guid), sim.fieldsByDirectedLink[dkey] || 0,
        'raw creatingFieldsWith for ' + fp.guid + '->' + target.guid + ' must match the link\'s real, simulated field count');
    });
  });
  assert.equal(sim.triangles.length, plan.triangles.length);
});

// Inbound keeps the opposite, still-correct shape: the chain link genuinely closes both
// triangles at once (both anchors have already thrown everything by the time any chain link is
// thrown), so its own raw annotation legitimately carries both third points.
test('buildHerringboneFanpoints: inbound\'s chain link genuinely closes 2 fields at once, unlike outbound\'s', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3]
  });

  const plan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', null);
  const converted = thisplugin.buildHerringboneFanpoints(plan);
  const order = toHostArray(converted.sortedFanpoints);
  const chainGuidsInOrder = chainGuids(plan);
  assert.ok(chainGuidsInOrder.length >= 2);

  const byGuid = {};
  order.forEach(function (fp) { byGuid[fp.guid] = fp; });

  const lastChainGuid = chainGuidsInOrder[chainGuidsInOrder.length - 1];
  const prevChainGuid = chainGuidsInOrder[chainGuidsInOrder.length - 2];
  const meta = byGuid[lastChainGuid].outgoingMeta[prevChainGuid];
  assert.equal(meta.creatingFieldsWith.length, 2,
    'the last chain portal\'s own link back to its predecessor closes both the A-side and B-side triangle at once, in inbound mode');

  const sim = thisplugin.simulateWalk(order);
  const dkey = thisplugin.getDirectedLinkKey(lastChainGuid, prevChainGuid);
  assert.equal(sim.fieldsByDirectedLink[dkey], 2);
});

test('computeHerringboneWalkDistance: inbound and outbound walk the exact same total distance for the same chain', () => {
  const { thisplugin } = createPluginSandbox();
  const fanpoints = fanpointsFrom({
    A: [0, 0], B: [100, 0],
    C: [20, 20], D: [50, 10], E: [80, 3]
  });

  // Outbound's own walk order is the exact reverse of inbound's for the same chain (see
  // buildHerringboneFanpoints), and distance is symmetric -- so the two totals must match
  // exactly, not just approximately.
  const inboundPlan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', {});
  const outboundPlan = thisplugin.buildHerringboneChain(fanpoints, 'A', 'B', { outbound: true });

  const inboundDistance = thisplugin.computeHerringboneWalkDistance(inboundPlan);
  const outboundDistance = thisplugin.computeHerringboneWalkDistance(outboundPlan);
  assert.ok(Math.abs(outboundDistance - inboundDistance) < 1e-9,
    'expected ' + inboundDistance + ' and ' + outboundDistance + ' to match up to floating-point noise');
});

test('buildHerringbonePlan: BEST mode returns whichever of a dedicated INBOUND/OUTBOUND search actually walks less', () => {
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

  thisplugin.availableSBUL = 0; // forces outbound's capacity cap to actually bite, so the two
                                 // modes genuinely end up walking different distances below

  const dedicatedInbound = thisplugin.buildHerringbonePlan(fanpoints, { mode: thisplugin.herringboneModeENUM.INBOUND });
  const dedicatedOutbound = thisplugin.buildHerringbonePlan(fanpoints, { mode: thisplugin.herringboneModeENUM.OUTBOUND });
  assert.ok(dedicatedInbound && dedicatedOutbound);

  const inboundDistance = thisplugin.computeHerringboneWalkDistance(dedicatedInbound);
  const outboundDistance = thisplugin.computeHerringboneWalkDistance(dedicatedOutbound);
  assert.notEqual(inboundDistance, outboundDistance,
    'the fixture must make INBOUND and OUTBOUND genuinely walk different distances for this to test anything');

  const best = thisplugin.buildHerringbonePlan(fanpoints, { mode: thisplugin.herringboneModeENUM.BEST });
  assert.ok(best, 'BEST must still find a plan');

  const bestDistance = thisplugin.computeHerringboneWalkDistance(best);
  const shorterDistance = Math.min(inboundDistance, outboundDistance);
  assert.ok(Math.abs(bestDistance - shorterDistance) < 1e-9,
    'BEST must walk exactly as little as the better of its own two dedicated sub-searches');
  assert.equal(best.outbound, outboundDistance < inboundDistance,
    'BEST must have actually kept the shorter-walking candidate, not just scored the same');
});
