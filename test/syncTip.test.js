'use strict';

// thisplugin.maybeShowSyncTip promotes the separate Simple Cloud Sync plugin: once right after
// install, then again once a week, capped at SYNC_TIP_MAX_SHOWN total appearances so it doesn't
// keep nagging an agent who just isn't interested. These tests drive it purely through its own
// localStorage bookkeeping (last-shown timestamp + shown count) rather than faking Date.now,
// the same way myActivityToday.test.js seeds timestamps directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

// Backdates the "last shown" timestamp so the next call looks like a week (or more) has passed.
function makeIntervalElapsed(thisplugin, localStorage) {
  const past = Date.now() - thisplugin.SYNC_TIP_INTERVAL_MS - 1000;
  localStorage.setItem(thisplugin.SYNC_TIP_STORAGE_KEY, past.toString());
}

test('maybeShowSyncTip: shows on first run and stops after SYNC_TIP_MAX_SHOWN appearances', () => {
  const { thisplugin, localStorage } = createPluginSandbox();

  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), '1');

  makeIntervalElapsed(thisplugin, localStorage);
  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), '2');

  makeIntervalElapsed(thisplugin, localStorage);
  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), '3');

  // A 4th week passing no longer triggers a 4th appearance -- the cap holds.
  makeIntervalElapsed(thisplugin, localStorage);
  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), '3');
});

test('maybeShowSyncTip: does not show again before a week has passed since the last time', () => {
  const { thisplugin, localStorage } = createPluginSandbox();

  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), '1');

  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), '1');
});

test('maybeShowSyncTip: never shows once Simple Cloud Sync is installed, even under the cap', () => {
  const { thisplugin, window, localStorage } = createPluginSandbox();
  window.plugin.simpleCloudSync = {};

  thisplugin.maybeShowSyncTip();
  assert.equal(localStorage.getItem(thisplugin.SYNC_TIP_COUNT_STORAGE_KEY), null);
});
