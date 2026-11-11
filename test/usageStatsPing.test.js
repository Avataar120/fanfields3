'use strict';

// The usage stats ping (thisplugin._statsPing, protocol v2): besides the hashed agent and the
// faction, it carries the plugin's state at ping time (thisplugin.statsUsageDetails: platform,
// version, mode, plan size bucket, options on) and the feature use counts recorded by
// thisplugin.countUsage since the previous ping, which each ping then resets.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

// Captures every beacon the plugin sends, decoded back to the JSON object it carried.
function captureBeacons(context) {
  const sent = [];
  context.Blob = class { constructor(parts) { this.text = parts.join(''); } };
  context.navigator.sendBeacon = function (url, blob) {
    sent.push({ url: url, payload: JSON.parse(blob.text) });
    return true;
  };
  return sent;
}

test('statsPlanSizeBucket: maps portal counts to the server\'s plan size buckets', () => {
  const { thisplugin } = createPluginSandbox();
  assert.equal(thisplugin.statsPlanSizeBucket(0), '0');
  assert.equal(thisplugin.statsPlanSizeBucket(1), '1-10');
  assert.equal(thisplugin.statsPlanSizeBucket(10), '1-10');
  assert.equal(thisplugin.statsPlanSizeBucket(11), '11-25');
  assert.equal(thisplugin.statsPlanSizeBucket(25), '11-25');
  assert.equal(thisplugin.statsPlanSizeBucket(26), '26-50');
  assert.equal(thisplugin.statsPlanSizeBucket(50), '26-50');
  assert.equal(thisplugin.statsPlanSizeBucket(51), '50+');
});

test('statsUsageDetails: reports platform, version, mode, plan size and the options that are on', () => {
  const { thisplugin, window, context } = createPluginSandbox();
  context.L.Browser.mobile = true;
  thisplugin.isTaskListDialogOpen = function () { return true; };
  thisplugin.fieldMode = thisplugin.fieldModeENUM.HERRINGBONE;
  thisplugin.sortedFanpoints = new Array(12).fill({});
  thisplugin.consumeKeysOnLinkThrown = true;
  thisplugin.manageBlockers = false;
  thisplugin.use_bookmarks_only = true;
  window.plugin.simpleCloudSync = {};

  const d = thisplugin.statsUsageDetails();
  assert.equal(d.platform, 'mobile');
  assert.match(d.version, /^\d+\.\d+\.\d+$/);
  assert.equal(d.mode, 'herringbone');
  assert.equal(d.plan, '11-25');
  assert.deepEqual(Array.from(d.flags), ['taskList', 'spendKeys', 'sync', 'bookmarksOnly']);
});

test('statsUsageDetails: desktop, fan mode, empty plan and no options on', () => {
  const { thisplugin, context } = createPluginSandbox();
  context.L.Browser.mobile = false;
  thisplugin.isTaskListDialogOpen = function () { return false; };
  thisplugin.fieldMode = thisplugin.fieldModeENUM.FAN;
  thisplugin.sortedFanpoints = [];
  thisplugin.consumeKeysOnLinkThrown = false;
  thisplugin.manageBlockers = false;
  thisplugin.use_bookmarks_only = false;

  const d = thisplugin.statsUsageDetails();
  assert.equal(d.platform, 'desktop');
  assert.equal(d.mode, 'fan');
  assert.equal(d.plan, '0');
  assert.deepEqual(Array.from(d.flags), []);
});

test('_statsPing: sends a v2 payload with the counted feature uses, then resets the counts', () => {
  const { thisplugin, context } = createPluginSandbox();
  const sent = captureBeacons(context);
  thisplugin.isTaskListDialogOpen = function () { return false; };
  thisplugin._statsAgentHash = 'a'.repeat(64);

  thisplugin.countUsage('reroute');
  thisplugin.countUsage('reroute');
  thisplugin.countUsage('keysVideo');
  thisplugin._statsPing();
  thisplugin._statsPing();

  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.v, 2);
  assert.equal(sent[0].payload.agent, 'a'.repeat(64));
  assert.equal(sent[0].payload.faction, 'RES');
  assert.deepEqual(sent[0].payload.used, { reroute: 2, keysVideo: 1 });
  assert.deepEqual(sent[1].payload.used, {});
});

test('_statsPing: sends nothing (and keeps the counts) until the agent hash is known', () => {
  const { thisplugin, context } = createPluginSandbox();
  const sent = captureBeacons(context);
  thisplugin.isTaskListDialogOpen = function () { return false; };

  thisplugin.countUsage('stats');
  thisplugin._statsPing();
  assert.equal(sent.length, 0);

  thisplugin._statsAgentHash = 'b'.repeat(64);
  thisplugin._statsPing();
  assert.deepEqual(sent[0].payload.used, { stats: 1 });
});

test('feature entry points count their own use', () => {
  const { thisplugin } = createPluginSandbox();

  thisplugin.toggleAnchorPicking(); // arming counts
  thisplugin.toggleAnchorPicking(); // disarming does not
  thisplugin.lock = function () {};
  thisplugin.toggleExcludedPortal('guid-1');

  assert.equal(thisplugin._statsUsed.anchor, 1);
  assert.equal(thisplugin._statsUsed.exclude, 1);
});
