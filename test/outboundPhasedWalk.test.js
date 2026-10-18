'use strict';

// Fan Field RADIATING (outbound) mode: the anchor must never be visited last, or any field whose
// 3rd point is the anchor itself can only ever complete on two SEPARATE throws, never together --
// see thisplugin.buildPhasedOutboundWalk's own comment, and the real-world bug this fixes
// (reported against a real 15-portal Antibes plan, anchor "Fresque de l'écomobilité": the Task
// List predicted 2 fields on most of the anchor's own links, but the in-game log showed only 1 for
// most of them -- confirmed structural, not a search-quality gap, and fixed by moving the anchor
// out of "last" into a 3-phase walk: Phase 1 (capture, in the fan field's own natural
// clockwise/counterclockwise sweep order) -> Phase 2 (the anchor, throwing everything) -> Phase 3
// (the remaining chain throws, in that SAME sweep order, which by then pairs their fields the same
// way an ordinary CENTRALIZING fan field's own mesh links already do).

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox, toHostArray } = require('./support/pluginSandbox');
const { loadFixturePortals, wirePlanInputs, buildPlan } = require('./support/planFixtures');

const portals76 = loadFixturePortals('orly-76-portals.json');
const ANCHORS_76 = [portals76[0].guid, portals76[38].guid, portals76[75].guid];

const antibesPortals = loadFixturePortals('antibes-15-portals.json');
const ANTIBES_ANCHOR = antibesPortals.find(function (p) { return p.title.indexOf("écomobilité") !== -1; }).guid;

// Every stop's own outgoing throw must only ever target a guid whose CAPTURE stop (the earliest
// occurrence of that guid in the walk) already precedes this stop -- the single most important
// correctness guarantee of the whole phased redesign: nothing is ever asked to throw a link
// before it could possibly hold the target's key.
function assertEveryKeyAvailableBeforeNeeded(walk) {
  const firstIndexByGuid = {};
  walk.forEach(function (fp, i) {
    if (firstIndexByGuid[fp.guid] === undefined) firstIndexByGuid[fp.guid] = i;
  });
  walk.forEach(function (fp, i) {
    (fp.outgoing || []).forEach(function (target) {
      const targetFirstIdx = firstIndexByGuid[target.guid];
      assert.ok(targetFirstIdx !== undefined && targetFirstIdx < i,
        'stop ' + i + ' (' + fp.guid.slice(0, 8) + ') throws to ' + target.guid.slice(0, 8) +
        ' whose own (capture) stop is not earlier in the walk -- the key could not possibly be held yet');
    });
  });
}

ANCHORS_76.forEach(function (anchorGuid) {
  test('buildPhasedOutboundWalk (anchor ' + anchorGuid.slice(0, 8) + '): every key is available before it is needed', async () => {
    const plan = await buildPlan(portals76, { mode: 'outbound', anchorGuid: anchorGuid });
    assertEveryKeyAvailableBeforeNeeded(toHostArray(plan.walkOrder));
  });

  test('buildPhasedOutboundWalk (anchor ' + anchorGuid.slice(0, 8) + '): Phase 3 never needs a key Phase 1 has not already collected', async () => {
    const plan = await buildPlan(portals76, { mode: 'outbound', anchorGuid: anchorGuid });
    const walk = toHostArray(plan.walkOrder);
    const anchorIdx = walk.findIndex(function (fp) { return fp.guid === anchorGuid; });
    assert.ok(anchorIdx > 0, 'the anchor must not be first any more');
    assert.ok(anchorIdx < walk.length - 1 || walk.length === anchorIdx + 1 && walk.slice(anchorIdx + 1).length === 0,
      'the anchor must not be the LAST stop of the walk when there is any chain-throwing portal at all');

    // Phase 3 throwers are whatever comes after the anchor; by construction every one of their
    // own outgoing targets' CAPTURE stops must already be behind the anchor (Phase 1) -- so no
    // Phase-3-internal precedence should ever be needed at all.
    const afterAnchor = walk.slice(anchorIdx + 1);
    const firstIndexByGuid = {};
    walk.forEach(function (fp, i) { if (firstIndexByGuid[fp.guid] === undefined) firstIndexByGuid[fp.guid] = i; });
    afterAnchor.forEach(function (fp) {
      (fp.outgoing || []).forEach(function (target) {
        const targetFirstIdx = firstIndexByGuid[target.guid];
        assert.ok(targetFirstIdx <= anchorIdx,
          'a Phase 3 thrower (' + fp.guid.slice(0, 8) + ') depends on a target (' + target.guid.slice(0, 8) +
          ') whose own first stop is not already behind the anchor -- Phase 1 should have covered it');
      });
    });
  });

  test('buildPhasedOutboundWalk (anchor ' + anchorGuid.slice(0, 8) + '): total field count never regresses', async () => {
    const plan = await buildPlan(portals76, { mode: 'outbound', anchorGuid: anchorGuid });
    const sim = plan.thisplugin.simulateWalk(toHostArray(plan.walkOrder));
    assert.equal(sim.triangles.length, plan.triangles.length,
      'the phased walk must realize every field the core build predicted, same as before this change');
    assert.equal(Object.keys(sim.invalid).length, 0, 'no link should become impossible to throw from under a field');
  });

  test('buildPhasedOutboundWalk (anchor ' + anchorGuid.slice(0, 8) + '): EVERY jet link closes together -- a hard guarantee, not a best effort', async () => {
    const plan = await buildPlan(portals76, { mode: 'outbound', anchorGuid: anchorGuid });
    const { thisplugin } = plan;
    const walk = toHostArray(plan.walkOrder);
    const sim = thisplugin.simulateWalk(walk);

    let jetLinks = 0, paired = 0;
    walk.forEach(function (fp) {
      toHostArray(fp.outgoing).forEach(function (target) {
        const meta = fp.outgoingMeta[target.guid];
        if (!(meta && meta.creatingFieldsWith && toHostArray(meta.creatingFieldsWith).length === 2)) return;
        jetLinks++;
        const dkey = thisplugin.getDirectedLinkKey(fp.guid, target.guid);
        if ((sim.fieldsByDirectedLink[dkey] || 0) === 2) paired++;
      });
    });

    assert.ok(jetLinks > 0, 'this dense fixture must have at least one jet link to exercise this guarantee');
    assert.equal(paired, jetLinks,
      paired + '/' + jetLinks + ' jet links closed together -- the maintainer was explicit after testing ' +
      'an earlier version in real play: never trade away a reachable double field closure, not even for ' +
      'walking distance. Every jet link in this plan must pair, with no exceptions.');
  });
});

test('buildPhasedOutboundWalk: CENTRALIZING is returned unchanged, by reference', () => {
  const { thisplugin } = createPluginSandbox();
  thisplugin.stardirection = thisplugin.starDirENUM.CENTRALIZING;
  const order = [{ guid: 'A', outgoing: [] }, { guid: 'B', outgoing: [] }];
  const result = thisplugin.buildPhasedOutboundWalk(order);
  assert.equal(result, order, 'CENTRALIZING must get back the exact same array reference, untouched');
});

test('the real Antibes 15-portal plan (reported bug): jet links now pair up, where the anchor-last walk never could', async () => {
  const plan = await buildPlan(antibesPortals, { mode: 'outbound', anchorGuid: ANTIBES_ANCHOR });
  const walk = toHostArray(plan.walkOrder);
  const sim = plan.thisplugin.simulateWalk(walk);

  // Baseline facts this bug report was built on: 29 total fields, 0 invalid links, 8
  // structurally-flagged jet links -- all still true after the fix (nothing about the TOTAL
  // changes, only how many pair up).
  assert.equal(plan.triangles.length, 29, 'fixture/anchor must still match the reported plan');
  assert.equal(sim.triangles.length, plan.triangles.length, 'no field lost');
  assert.equal(Object.keys(sim.invalid).length, 0, 'no link invalidated');

  let jetLinks = 0;
  walk.forEach(function (fp) {
    toHostArray(fp.outgoing).forEach(function (target) {
      const meta = fp.outgoingMeta[target.guid];
      if (meta && meta.creatingFieldsWith && toHostArray(meta.creatingFieldsWith).length === 2) jetLinks++;
    });
  });
  assert.equal(jetLinks, 8, 'fixture/anchor must still match the reported plan');

  const jetPairs = plan.thisplugin.countJetPairsClosedTogether(sim, walk);
  assert.equal(jetPairs, 8,
    'before this fix: 0 of 8 jet links ever closed together, proven structurally impossible under ' +
    'the old anchor-last walk (every one of them has the anchor itself as a 3rd point). The maintainer ' +
    'was explicit after testing an earlier, partial fix in real play: ALL 8, not just "some", since a ' +
    'reachable double field must never be traded away for anything else (walking distance included).');
});

test('buildPhasedOutboundWalk: a doubled (capture+throw) portal gets two distinct stopKeys, tracked independently by isPortalDone', async () => {
  const plan = await buildPlan(antibesPortals, { mode: 'outbound', anchorGuid: ANTIBES_ANCHOR });
  const { thisplugin } = plan;
  const walk = toHostArray(plan.walkOrder);

  const stopKeys = walk.map(function (fp) { return fp.stopKey; });
  assert.equal(new Set(stopKeys).size, stopKeys.length, 'no two stops may share a stopKey');

  const doubled = walk.filter(function (fp) { return fp.stopKey && fp.stopKey.indexOf('#') !== -1; });
  assert.ok(doubled.length >= 2, 'this plan must have at least one doubled portal (capture + throw stop) to exercise this test');

  const byGuid = {};
  doubled.forEach(function (fp) { (byGuid[fp.guid] = byGuid[fp.guid] || []).push(fp); });
  const guidWithTwoStops = Object.keys(byGuid).find(function (guid) { return byGuid[guid].length === 2; });
  assert.ok(guidWithTwoStops, 'at least one portal must have both its capture and throw stop present');

  const captureStop = byGuid[guidWithTwoStops].find(function (fp) { return fp.stopKey.endsWith('#1'); });
  const throwStop = byGuid[guidWithTwoStops].find(function (fp) { return fp.stopKey.endsWith('#2'); });
  assert.ok(captureStop && throwStop, 'a doubled portal must have exactly one #1 (capture) and one #2 (throw) stop');
  assert.ok(throwStop.outgoing.length > 0, 'the throw stop must carry at least the deferred link(s) that required it');

  thisplugin.isPortalDone(captureStop, true); // mark only the capture stop as finished ("Nothing")
  assert.equal(thisplugin.isPortalDone(captureStop, false), true, 'the capture stop stays marked done');
  assert.equal(thisplugin.isPortalDone(throwStop, false), false,
    'the SAME portal\'s throw stop must still be its own, independent, not-yet-done state');
});

test('buildTaskListHTML: a doubled portal never produces a duplicate row DOM id', async () => {
  const plan = await buildPlan(antibesPortals, { mode: 'outbound', anchorGuid: ANTIBES_ANCHOR });
  const html = plan.thisplugin.buildTaskListHTML();

  const ids = toHostArray(html.match(/id="plugin_fanfields3_exportText_[^"]+"/g) || []);
  assert.ok(ids.length > 0, 'the Task List must render at least one portal row');
  assert.equal(new Set(ids).size, ids.length, 'every rendered row must have a unique DOM id, even for a doubled portal');
});
