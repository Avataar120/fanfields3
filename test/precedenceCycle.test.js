'use strict';

// thisplugin.hasPrecedenceCycle is the exact veto PR #37 added at every place "Less walking"
// considers flipping a mesh link's direction (computeDistanceOrderFlips, both the initial flip
// decision and the later "free up a cheaper gap" flip, and the equivalent in
// computeKeysOrderFlips): a flip is only ever accepted if, combined with every other edge
// already decided, it still leaves a single consistent visiting order. The existing end-to-end
// "Less walking" tests (walkOrder.test.js) only check that the FINAL plan on one real 76-portal
// fixture happens to be walkable -- nothing there proves this function itself still rejects a
// cycle correctly, since that one fixture may or may not ever exercise the rejection path. These
// tests isolate the function directly against hand-built edge lists that are guaranteed to.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

function edge(srcGuid, dstGuid) {
  return { srcGuid: srcGuid, dstGuid: dstGuid, key: srcGuid + '>' + dstGuid, isFanLink: false };
}

test('hasPrecedenceCycle: false for an empty edge list', () => {
  const { thisplugin } = createPluginSandbox();
  assert.equal(thisplugin.hasPrecedenceCycle([]), false);
});

test('hasPrecedenceCycle: false for a simple chain (A throws to B, B throws to C)', () => {
  const { thisplugin } = createPluginSandbox();
  // A needs B's key first, B needs C's key first -- visiting order C, B, A satisfies both.
  const edges = [edge('A', 'B'), edge('B', 'C')];
  assert.equal(thisplugin.hasPrecedenceCycle(edges), false);
});

test('hasPrecedenceCycle: false for a diamond sharing one target (no actual cycle)', () => {
  const { thisplugin } = createPluginSandbox();
  // A and C both throw to D; B throws to A. No guid ever depends on itself, directly or
  // transitively -- visiting order D, A, B, C (or D, C, B, A) works.
  const edges = [edge('A', 'D'), edge('C', 'D'), edge('B', 'A')];
  assert.equal(thisplugin.hasPrecedenceCycle(edges), false);
});

test('hasPrecedenceCycle: true for a direct 3-cycle (A->B->C->A)', () => {
  const { thisplugin } = createPluginSandbox();
  // A needs B's key, B needs C's key, C needs A's key -- no order can ever satisfy all three.
  const edges = [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')];
  assert.equal(thisplugin.hasPrecedenceCycle(edges), true);
});

test('hasPrecedenceCycle: true for a 2-cycle introduced by a single candidate flip', () => {
  const { thisplugin } = createPluginSandbox();
  // This is exactly the shape a single bad flip creates: an otherwise fine chain (X->A->B)
  // plus one more edge (B->A) that flips a link the other way, so A and B end up each needing
  // the other's key first.
  const edges = [edge('X', 'A'), edge('A', 'B'), edge('B', 'A')];
  assert.equal(thisplugin.hasPrecedenceCycle(edges), true);
});

test('hasPrecedenceCycle: a cycle elsewhere in a larger, mostly acyclic graph is still caught', () => {
  const { thisplugin } = createPluginSandbox();
  const edges = [
    edge('P1', 'P2'), edge('P2', 'P3'), edge('P3', 'P4'), edge('P4', 'P5'), // long acyclic chain
    edge('Q1', 'Q2'), edge('Q2', 'Q3'), edge('Q3', 'Q1') // unrelated cycle among different guids
  ];
  assert.equal(thisplugin.hasPrecedenceCycle(edges), true);
});
