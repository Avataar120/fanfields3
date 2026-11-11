'use strict';

// thisplugin.tickStarTip promotes starring the GitHub repo: once after roughly 2 hours of active
// use, and once more after 5 hours, each threshold firing at most once ever. These tests drive it
// purely through its own localStorage bookkeeping (accumulated active seconds + shown
// thresholds), the same way syncTip.test.js drives thisplugin.maybeShowSyncTip, and stub
// thisplugin.showStarTipDialog itself rather than calling it for real -- it ends in a
// `$(...).dialog('option', 'buttons', ...)` call the jQuery test stub doesn't implement, the same
// reason no test here calls thisplugin.confirmDialog or thisplugin.showManageOpsDialog directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox, toHostArray } = require('./support/pluginSandbox');

function countShown(thisplugin, localStorage) {
  let shows = 0;
  thisplugin.showStarTipDialog = function () { shows++; };
  return () => shows;
}

test('tickStarTip: does not show before the first threshold is reached', () => {
  const { thisplugin, localStorage } = createPluginSandbox();
  const getShows = countShown(thisplugin, localStorage);

  const ticksBeforeFirstThreshold = Math.floor(thisplugin.STAR_TIP_THRESHOLDS_S[0] / thisplugin.STAR_TIP_TICK_SECONDS) - 1;
  for (let i = 0; i < ticksBeforeFirstThreshold; i++) thisplugin.tickStarTip();

  assert.equal(getShows(), 0);
  assert.equal(thisplugin.getStarTipShownThresholds().length, 0);
});

test('tickStarTip: shows once on crossing the first threshold, then not again until the second', () => {
  const { thisplugin, localStorage } = createPluginSandbox();
  const getShows = countShown(thisplugin, localStorage);

  const ticksToFirstThreshold = thisplugin.STAR_TIP_THRESHOLDS_S[0] / thisplugin.STAR_TIP_TICK_SECONDS;
  for (let i = 0; i < ticksToFirstThreshold; i++) thisplugin.tickStarTip();
  assert.equal(getShows(), 1);
  assert.deepEqual(toHostArray(thisplugin.getStarTipShownThresholds()), [thisplugin.STAR_TIP_THRESHOLDS_S[0]]);

  // A handful more ticks, still well short of the second threshold: no further dialog.
  thisplugin.tickStarTip();
  thisplugin.tickStarTip();
  assert.equal(getShows(), 1);
});

test('tickStarTip: shows again on crossing the second threshold', () => {
  const { thisplugin, localStorage } = createPluginSandbox();
  const getShows = countShown(thisplugin, localStorage);

  const ticksToSecondThreshold = thisplugin.STAR_TIP_THRESHOLDS_S[1] / thisplugin.STAR_TIP_TICK_SECONDS;
  for (let i = 0; i < ticksToSecondThreshold; i++) thisplugin.tickStarTip();

  assert.equal(getShows(), 2);
  assert.deepEqual(toHostArray(thisplugin.getStarTipShownThresholds()).sort((a, b) => a - b),
    toHostArray(thisplugin.STAR_TIP_THRESHOLDS_S).sort((a, b) => a - b));
});

test('tickStarTip: a single tick that jumps past both thresholds at once shows only one dialog', () => {
  const { thisplugin, localStorage } = createPluginSandbox();
  const getShows = countShown(thisplugin, localStorage);

  localStorage.setItem(thisplugin.STAR_TIP_ACTIVE_SECONDS_KEY, String(thisplugin.STAR_TIP_THRESHOLDS_S[1]));
  thisplugin.tickStarTip();

  assert.equal(getShows(), 1);
  assert.deepEqual(toHostArray(thisplugin.getStarTipShownThresholds()).sort((a, b) => a - b),
    toHostArray(thisplugin.STAR_TIP_THRESHOLDS_S).sort((a, b) => a - b));

  // Never shows again afterwards, for either threshold.
  thisplugin.tickStarTip();
  assert.equal(getShows(), 1);
});

test('tickStarTip: active seconds accumulate across separate calls', () => {
  const { thisplugin, localStorage } = createPluginSandbox();

  thisplugin.tickStarTip();
  thisplugin.tickStarTip();
  assert.equal(
    localStorage.getItem(thisplugin.STAR_TIP_ACTIVE_SECONDS_KEY),
    String(2 * thisplugin.STAR_TIP_TICK_SECONDS)
  );
});
