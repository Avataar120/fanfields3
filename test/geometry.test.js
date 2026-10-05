'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox, FakePoint } = require('./support/pluginSandbox');

const { thisplugin } = createPluginSandbox();

test('pointPairKey is the same regardless of argument order (undirected)', () => {
  const a = new FakePoint(1, 2);
  const b = new FakePoint(3, 4);
  assert.equal(thisplugin.pointPairKey(a, b), thisplugin.pointPairKey(b, a));
});

test('pointPairKey differs for a different pair of points', () => {
  const a = new FakePoint(1, 2);
  const b = new FakePoint(3, 4);
  const c = new FakePoint(5, 6);
  assert.notEqual(thisplugin.pointPairKey(a, b), thisplugin.pointPairKey(a, c));
});

test('getUndirectedLinkKey is order-independent, getDirectedLinkKey is not', () => {
  assert.equal(thisplugin.getUndirectedLinkKey('g1', 'g2'), thisplugin.getUndirectedLinkKey('g2', 'g1'));
  assert.notEqual(thisplugin.getDirectedLinkKey('g1', 'g2'), thisplugin.getDirectedLinkKey('g2', 'g1'));
});

test('distanceTo is symmetric and zero for the same point', () => {
  const a = new FakePoint(0, 0);
  const b = new FakePoint(3, 4);
  assert.equal(thisplugin.distanceTo(a, a), 0);
  assert.equal(thisplugin.distanceTo(a, b), thisplugin.distanceTo(b, a));
  assert.equal(thisplugin.distanceTo(a, b), 5); // 3-4-5 triangle, under the sandbox's flat projection
});

test('intersects: two segments that cross each other', () => {
  const link1 = { a: new FakePoint(0, 0), b: new FakePoint(10, 10) };
  const link2 = { a: new FakePoint(0, 10), b: new FakePoint(10, 0) };
  assert.equal(thisplugin.intersects(link1, link2), 1);
});

test('intersects: two parallel segments never cross', () => {
  const link1 = { a: new FakePoint(0, 0), b: new FakePoint(10, 0) };
  const link2 = { a: new FakePoint(0, 5), b: new FakePoint(10, 5) };
  assert.equal(thisplugin.intersects(link1, link2), 0);
});

test('intersects: segments sharing an endpoint are not a crossing', () => {
  const shared = new FakePoint(5, 5);
  const link1 = { a: shared, b: new FakePoint(0, 0) };
  const link2 = { a: shared, b: new FakePoint(10, 0) };
  assert.equal(thisplugin.intersects(link1, link2), false);
});

test('pointInTriangleStrict: inside, outside and on-the-border points', () => {
  const a = new FakePoint(0, 0);
  const b = new FakePoint(10, 0);
  const c = new FakePoint(0, 10);

  assert.equal(thisplugin.pointInTriangleStrict(new FakePoint(2, 2), a, b, c), true);
  assert.equal(thisplugin.pointInTriangleStrict(new FakePoint(20, 20), a, b, c), false);
  // On a vertex, or on an edge: strictly "not under" by design (see the function's own comment).
  assert.equal(thisplugin.pointInTriangleStrict(a, a, b, c), false);
  assert.equal(thisplugin.pointInTriangleStrict(new FakePoint(5, 0), a, b, c), false);
});

test('isPointUnderAnyTriangle: true for any one matching triangle, false with none', () => {
  const triangles = [{ a: new FakePoint(0, 0), b: new FakePoint(10, 0), c: new FakePoint(0, 10) }];
  assert.equal(thisplugin.isPointUnderAnyTriangle(new FakePoint(2, 2), triangles), true);
  assert.equal(thisplugin.isPointUnderAnyTriangle(new FakePoint(50, 50), triangles), false);
  assert.equal(thisplugin.isPointUnderAnyTriangle(new FakePoint(2, 2), []), false);
});
