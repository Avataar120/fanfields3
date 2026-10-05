'use strict';

// thisplugin.tallyMyActivity is the pure counting logic behind the Stats dialog's "Your
// activity today" section (added when that feature moved from counting the whole faction's
// activity -- the only thing window.links/window.fields can tell you, since they carry a team
// but never an agent name -- to counting only the player's own throws/fields, read from the
// faction Comm feed instead. These tests exercise that counting logic directly against
// hand-built Comm message shapes (the same { time, player: {name}, markup } shape
// IITC.comm.parseMsgData produces), without touching the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

function textEntry(plain) {
  return ['TEXT', { plain: plain }];
}

// processed: the guid -> [time, auto, html, nick, parsedData] hash IITC.comm hands to
// 'factionChatDataAvailable' listeners (see map_renderer.js/comm.js) -- only parsedData (index
// 4) is read by tallyMyActivity, the rest is padding to match the real shape.
function fakeProcessed(entries) {
  var processed = {};
  entries.forEach(function (e, i) {
    processed['guid' + i] = [e.time, false, '', e.player.name, e];
  });
  return processed;
}

test('tallyMyActivity: counts a "linked" message from the player today as a link', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  const processed = fakeProcessed([
    { time: now, player: { name: window.PLAYER.nickname }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] }
  ]);
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.links, 1);
  assert.equal(result.fields, 0);
});

test('tallyMyActivity: counts a "created a Control Field" message from the player today as a field', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  const processed = fakeProcessed([
    { time: now, player: { name: window.PLAYER.nickname }, markup: [textEntry('agent TestAgent created a Control Field @Portal A +184 MUs')] }
  ]);
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.fields, 1);
  assert.equal(result.links, 0);
});

test('tallyMyActivity: a "destroyed" message never counts, even from the player', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  const processed = fakeProcessed([
    { time: now, player: { name: window.PLAYER.nickname }, markup: [textEntry('Agent TestAgent destroyed the Link Portal A to Portal B')] }
  ]);
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.links, 0);
  assert.equal(result.fields, 0);
});

test('tallyMyActivity: messages from another agent never count, even on the same team', () => {
  const { thisplugin } = createPluginSandbox();
  const now = Date.now();
  const processed = fakeProcessed([
    { time: now, player: { name: 'SomeoneElse' }, markup: [textEntry('agent SomeoneElse linked from Portal A to Portal B')] }
  ]);
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.links, 0);
  assert.equal(result.fields, 0);
});

test('tallyMyActivity: a message from before today\'s local midnight is excluded, but still updates oldestSeen', () => {
  const { thisplugin, window } = createPluginSandbox();
  const yesterday = thisplugin.getTodayCutoff() - 60 * 60 * 1000; // 1h before today started
  const processed = fakeProcessed([
    { time: yesterday, player: { name: window.PLAYER.nickname }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] }
  ]);
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.links, 0, 'yesterday\'s link must not be counted as today\'s activity');
  assert.equal(result.oldestSeen, yesterday, 'the pagination loop needs this to know it has reached far enough back');
});

test('tallyMyActivity: with no window.PLAYER.nickname, returns zero counts instead of throwing', () => {
  const { thisplugin, window } = createPluginSandbox();
  window.PLAYER.nickname = undefined;
  const result = thisplugin.tallyMyActivity({});
  assert.equal(result.links, 0);
  assert.equal(result.fields, 0);
});
