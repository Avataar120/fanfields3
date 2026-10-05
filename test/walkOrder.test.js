'use strict';

// "Less walking" (DISTANCE link-order mode) against a real, 76-portal dataset, in both fan
// modes (inbound/CENTRALIZING and outbound/RADIATING). Three things matter here, all of which
// the real algorithm must guarantee regardless of which portal is picked as anchor:
//  - the fan field principle itself: every portal still links to the anchor (directly or via
//    the mesh), and no field the core build decided to form is ever lost by how "Less walking"
//    walks the plan (see the fields/valid-fields assertions below);
//  - the resulting plan must actually be walkable in a single pass at all -- a precedence cycle
//    (A needs B's key, B needs C's, C needs A's) would mean no order works, regardless of how
//    good or bad it is (this exact cycle was a real, confirmed bug -- see below);
//  - subject to both, the walk shouldn't be meaningfully longer than an independently computed
//    reference order (test/support/referenceWalkOrder.js, written from scratch, not reusing any
//    of the plugin's own ordering code).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixturePortals, buildPlan } = require('./support/planFixtures');
const { computeReferenceWalkOrder, buildPrecedences } = require('./support/referenceWalkOrder');

const portals = loadFixturePortals('orly-76-portals.json');
const ANCHORS = [portals[0].guid, portals[38].guid, portals[75].guid];
const REFERENCE_BUDGET_MS = 3000;

// How many portals in `sortedFanpoints` can be reordered into a position that satisfies every
// "target before source" key dependency at once -- see hasPrecedenceCycle's own comment in the
// plugin for why a cycle here means no walk order at all would work, not just a suboptimal one.
function isWalkable(sortedFanpoints) {
  const n = sortedFanpoints.length;
  const precedences = buildPrecedences(sortedFanpoints);
  const indegree = new Array(n).fill(0);
  const successors = Array.from({ length: n }, function () { return []; });
  precedences.forEach(function (pair) {
    successors[pair[0]].push(pair[1]);
    indegree[pair[1]]++;
  });
  const queue = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);
  let resolved = 0;
  while (queue.length) {
    const node = queue.shift();
    resolved++;
    successors[node].forEach(function (next) {
      if (--indegree[next] === 0) queue.push(next);
    });
  }
  return resolved === n;
}

['inbound', 'outbound'].forEach(function (mode) {
  ANCHORS.forEach(function (anchorGuid) {
    const label = mode + ' mode, anchor ' + anchorGuid.slice(0, 8);

    test('Less walking (' + label + '): never loses a field the plan built', async () => {
      const plan = await buildPlan(portals, { mode: mode, anchorGuid: anchorGuid });
      assert.equal(plan.thisplugin.validTriangleCount, plan.triangles.length,
        'validTriangleCount (fields the walk order can actually form) must equal ' +
        'triangles.length (fields the core build decided should exist) -- a mismatch means ' +
        'the walk order made a link impossible to throw from under a field that the build ' +
        'otherwise relied on.');
    });

    test('Less walking (' + label + '): the resulting plan is walkable in a single pass ' +
      '(no key-dependency cycle)', async () => {
      const plan = await buildPlan(portals, { mode: mode, anchorGuid: anchorGuid });
      assert.equal(isWalkable(plan.sortedFanpoints), true,
        'a precedence cycle here means some portal needs a key from another portal that ' +
        'itself (directly or transitively) needs a key from the first one -- no walk order, ' +
        'however reordered, could ever satisfy all of them at once.');
    });

    test('Less walking (' + label + '): walk distance is not a meaningful regression against ' +
      'an independently computed reference order', async () => {
      const plan = await buildPlan(portals, { mode: mode, anchorGuid: anchorGuid });
      const reference = computeReferenceWalkOrder(plan.thisplugin, plan.sortedFanpoints,
        { timeBudgetMs: REFERENCE_BUDGET_MS });

      assert.equal(reference.violations, 0, 'the reference order itself must be fully playable');
      assert.ok(reference.fields >= plan.triangles.length,
        'the reference never forms fewer fields than the real plan (same link structure, so ' +
        'this should always hold -- a failure here would mean the reference itself is unfair)');

      // Outbound mode has a known, already-flagged gap against this reference (see the plugin's
      // own orderPrefixForOutbound: a 300ms-budgeted local search over only a sub-segment of the
      // walk) -- a wider tolerance here reflects that known limitation rather than hiding a
      // fresh regression. Tightening this number is exactly how that gap would get re-measured
      // if orderPrefixForOutbound is ever improved.
      const tolerance = mode === 'outbound' ? 1.75 : 1.15;
      assert.ok(plan.totalWalkDistance <= reference.totalDistance * tolerance,
        'plan distance ' + plan.totalWalkDistance.toFixed(4) + ' vs reference ' +
        reference.totalDistance.toFixed(4) + ' (ratio ' +
        (plan.totalWalkDistance / reference.totalDistance).toFixed(2) + ', tolerance ' + tolerance + ')');
    });
  });
});
