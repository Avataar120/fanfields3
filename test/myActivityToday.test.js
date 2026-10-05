'use strict';

// thisplugin.tallyMyActivity is the pure counting logic behind the Stats dialog's "Your
// activity today" section (added when that feature moved from counting the whole faction's
// activity -- the only thing window.links/window.fields can tell you, since they carry a team
// but never an agent name -- to counting only the player's own throws/fields, read from the
// Faction AND All Comm feeds instead (thisplugin.refreshMyActivityToday reads both, since
// either one alone can come back thin for a given account/session). These tests exercise the
// counting logic directly against hand-built Comm message shapes (the same
// { time, player: {name}, markup } shape IITC.comm.parseMsgData produces), without touching
// the network, plus the multi-channel merge in refreshMyActivityToday itself, using the
// addHook/removeHook pub-sub and IITC.comm.requestChannel stubs in pluginSandbox.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

function textEntry(plain) {
  return ['TEXT', { plain: plain }];
}

// One processed-hash entry: [time, auto, html, nick, parsedData] -- the shape IITC.comm hands
// to its "<channel>ChatDataAvailable" listeners (see map_renderer.js/comm.js). tallyMyActivity
// reads the time off the tuple itself (index 0), and matches the author against any of three
// independent signals (tuple nick, parsedData.player.name, a PLAYER/SENDER markup entry) --
// see thisplugin.getMessageAuthorCandidates.
function toProcessedEntry(e) {
  return [e.time, false, '', e.player.name, e];
}

// processed: a guid -> toProcessedEntry(...) hash, with an auto-numbered guid per entry --
// fine for tests that only ever simulate a single Comm channel's page. A test simulating TWO
// channels builds its processed hashes by hand instead (with its own guid keys), so each
// channel's entries land under distinct keys exactly like real, globally unique Comm guids
// would -- auto-numbering both pages from 0 would collide and silently overwrite one
// channel's entries with the other's when the two pages are merged.
function fakeProcessed(entries) {
  var processed = {};
  entries.forEach(function (e, i) {
    processed['guid' + i] = toProcessedEntry(e);
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

test('tallyMyActivity: counts a "linked" message whose markup has no \'TEXT\' entry at all, by falling back to the rendered row\'s own HTML', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  // Reproduces a real build observed in the field: a public cross-faction echo of an own-
  // faction link ("FACTION agent PLAYER linked PORTAL to PORTAL") whose markup carries the
  // narrative words ("agent", "linked", "to", …) baked into the rendering itself, not as a
  // plain 'TEXT' entry -- the message visibly reads "agent Avataar120 linked from Livres pour
  // tous to boite a livre gare d'orly" in the Comm panel, but markup.filter(TEXT) finds
  // nothing. The already-rendered row HTML (entry[2], here with onclick/href noise exactly
  // like a real portal link) is the only place "linked" actually appears as text.
  const ownName = window.PLAYER.nickname;
  const html = '<td><mark>FACTION:&lt;Resistance&gt;</mark></td>' +
    '<td>agent <span onclick="foo()">' + ownName + '</span> linked from ' +
    '<a href="javascript:void(0)" onclick="bar()">Livres pour tous</a> to ' +
    '<a href="javascript:void(0)" onclick="baz()">boite a livre gare d\'orly</a></td>';
  const processed = {
    guid0: [now, false, html, ownName, {
      time: now,
      player: { name: ownName },
      markup: [
        ['FACTION', { team: 'RESISTANCE' }],
        ['PLAYER', { plain: ownName, team: 'RESISTANCE' }],
        ['PORTAL', { name: 'Livres pour tous', address: 'somewhere' }],
        ['PORTAL', { name: 'boite a livre gare d\'orly', address: 'somewhere else' }]
      ]
    }]
  };

  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.ownSeen, 1, 'the author match must still succeed (it never depended on markup TEXT entries)');
  assert.equal(result.links, 1, 'the HTML fallback must recover "linked" that no TEXT markup entry carried');
});

test('tallyMyActivity: still matches the player via the tuple\'s own nick field when parsedData.player is missing or wrong', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  // Some IITC builds' parsedData shape doesn't carry a usable .player (or carries the wrong
  // name) even though the tuple's own nick field -- what the Comm panel itself uses to
  // highlight "your own" messages -- is correct; this must still count the action.
  const processed = {
    guid0: [now, false, '', window.PLAYER.nickname, {
      time: now,
      player: { name: '' }, // simulates a build where parsedData.player.name never gets set
      markup: [textEntry('agent TestAgent linked from Portal A to Portal B')]
    }]
  };
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.links, 1);
});

test('tallyMyActivity: still matches the player via a PLAYER markup entry when both the tuple nick and parsedData.player are missing or wrong', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  // Simulates a build where neither the tuple's own nick field nor parsedData.player.name
  // carries the real agent name, but the message's own markup still names the actor (the text
  // the message itself is built from).
  const processed = {
    guid0: [now, false, '', '', {
      time: now,
      player: { name: '' },
      markup: [
        ['PLAYER', { plain: window.PLAYER.nickname }],
        textEntry(' linked from Portal A to Portal B')
      ]
    }]
  };
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.links, 1);
});

test('tallyMyActivity: reports how many messages were read and how many were recognized as the player\'s own', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  const processed = fakeProcessed([
    { time: now, player: { name: window.PLAYER.nickname }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] },
    { time: now, player: { name: 'SomeoneElse' }, markup: [textEntry('agent SomeoneElse linked from Portal C to Portal D')] }
  ]);
  const result = thisplugin.tallyMyActivity(processed);
  assert.equal(result.totalSeen, 2);
  assert.equal(result.ownSeen, 1);
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

test('diagnoseMyActivityUnavailable: null (available) when IITC.comm and the player nickname are both present', () => {
  const { thisplugin } = createPluginSandbox();
  assert.equal(thisplugin.diagnoseMyActivityUnavailable(), null);
});

test('diagnoseMyActivityUnavailable: null (available) via the legacy window.chat.requestFaction path, even with no window.IITC at all', () => {
  const { thisplugin, window } = createPluginSandbox();
  delete window.IITC;
  window.chat = { requestFaction: function () {}, requestPublic: function () {} };
  assert.equal(thisplugin.diagnoseMyActivityUnavailable(), null);
});

test('diagnoseMyActivityUnavailable: reports when neither window.IITC.comm nor window.chat.requestFaction exists', () => {
  const { thisplugin, window } = createPluginSandbox();
  delete window.IITC;
  assert.match(thisplugin.diagnoseMyActivityUnavailable(), /neither window\.IITC\.comm\.requestChannel nor window\.chat\.requestFaction/);
});

test('diagnoseMyActivityUnavailable: reports when IITC.comm is missing and window.chat has no requestFaction either', () => {
  const { thisplugin, window } = createPluginSandbox();
  delete window.IITC.comm;
  assert.match(thisplugin.diagnoseMyActivityUnavailable(), /neither window\.IITC\.comm\.requestChannel nor window\.chat\.requestFaction/);
});

test('diagnoseMyActivityUnavailable: reports when the player nickname is not loaded yet', () => {
  const { thisplugin, window } = createPluginSandbox();
  window.PLAYER.nickname = undefined;
  assert.match(thisplugin.diagnoseMyActivityUnavailable(), /player info/);
});

test('getCommRequestFn: prefers window.chat.requestFaction over window.IITC.comm.requestChannel when both exist', () => {
  const { thisplugin, window } = createPluginSandbox();
  var legacyCalled = false;
  window.chat = { requestFaction: function () { legacyCalled = true; } };
  thisplugin.getCommRequestFn('faction')();
  assert.equal(legacyCalled, true);
  assert.equal(window._commRequests.length, 0, 'the modern API must not be called when the legacy one is used');
});

test('getCommRequestFn: falls back to window.IITC.comm.requestChannel when window.chat has no matching method', () => {
  const { thisplugin, window } = createPluginSandbox();
  thisplugin.getCommRequestFn('faction')(false);
  assert.deepEqual(window._commRequests, [{ channel: 'faction', olderMsgs: false }]);
});

test('refreshMyActivityToday: shows the specific unavailable reason in the Stats dialog body', () => {
  const { thisplugin, window } = createPluginSandbox();
  delete window.IITC.comm;
  thisplugin.refreshMyActivityToday();
  assert.equal(thisplugin.myActivityState, 'error');
  assert.match(thisplugin.buildRealActivityBodyHTML(), /neither window\.IITC\.comm\.requestChannel nor window\.chat\.requestFaction/);
});

test('refreshMyActivityToday: requests both the Faction and All channels, with the correct hook names', () => {
  const { thisplugin, window } = createPluginSandbox();
  thisplugin.refreshMyActivityToday();

  assert.equal(thisplugin.myActivityState, 'loading');
  const requestedChannels = window._commRequests.map(function (r) { return r.channel; }).sort();
  assert.deepEqual(requestedChannels, ['all', 'faction']);
  // 'all' fires a differently-named hook than the generic "<channel>ChatDataAvailable" pattern
  // every other channel (including 'faction') uses -- see IITC-CE's core/code/comm.js.
  assert.equal((window._hookListeners.factionChatDataAvailable || []).length, 1);
  assert.equal((window._hookListeners.publicChatDataAvailable || []).length, 1);
});

test('refreshMyActivityToday: merges counts from both channels', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  const yesterday = thisplugin.getTodayCutoff() - 60 * 60 * 1000;
  const ownName = window.PLAYER.nickname;

  thisplugin.refreshMyActivityToday();

  // Each page also carries a message from before today, so oldestSeen <= cutoff and this single
  // page ends that channel's pagination right away (see thisplugin.refreshMyActivityToday).
  window._hookListeners.factionChatDataAvailable[0]({
    processed: {
      f1: toProcessedEntry({ time: now, player: { name: ownName }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] }),
      f2: toProcessedEntry({ time: yesterday, player: { name: ownName }, markup: [textEntry('agent TestAgent linked from Portal E to Portal F')] })
    }
  });
  window._hookListeners.publicChatDataAvailable[0]({
    processed: {
      a1: toProcessedEntry({ time: now, player: { name: ownName }, markup: [textEntry('agent TestAgent created a Control Field @Portal G +184 MUs')] }),
      a2: toProcessedEntry({ time: yesterday, player: { name: ownName }, markup: [textEntry('agent TestAgent linked from Portal H to Portal I')] })
    }
  });

  assert.equal(thisplugin.myActivityState, 'done');
  assert.equal(thisplugin.myActivityToday.links, 1, 'the Faction channel\'s own link counts');
  assert.equal(thisplugin.myActivityToday.fields, 1, 'the All channel\'s own field counts too');
});

test('refreshMyActivityToday: the same action reported on both channels is only counted once', () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();
  const yesterday = thisplugin.getTodayCutoff() - 60 * 60 * 1000;
  const ownName = window.PLAYER.nickname;

  thisplugin.refreshMyActivityToday();

  // Real Comm log entries are globally unique, so the same action thrown by the player shows
  // up under the SAME guid on both the Faction and All channels -- merging must not double it.
  const sharedEntry = toProcessedEntry({ time: now, player: { name: ownName }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] });
  const olderEntry = toProcessedEntry({ time: yesterday, player: { name: ownName }, markup: [textEntry('agent TestAgent linked from Portal E to Portal F')] });

  window._hookListeners.factionChatDataAvailable[0]({ processed: { shared: sharedEntry, older1: olderEntry } });
  window._hookListeners.publicChatDataAvailable[0]({ processed: { shared: sharedEntry, older2: olderEntry } });

  assert.equal(thisplugin.myActivityState, 'done');
  assert.equal(thisplugin.myActivityToday.links, 1, 'the shared guid must be counted once, not twice');
});

test('refreshMyActivityToday: still reports a channel\'s activity when its request comes back with nothing new to add (no hook fires)', async () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();

  // IITC.comm.requestChannel silently fires no hook at all whenever its response has nothing
  // new on top of what it already knows (see comm.js _handleChannel's own "no new data"
  // shortcut) -- the common case once something else (IITC's own background refresh of a
  // visible chat tab, or an earlier page of this very fetch) already caught the channel up.
  // Simulated here by seeding IITC.comm's own live store directly and never firing either
  // channel's hook at all: thisplugin.refreshMyActivityToday must fall back to that live store
  // once its own per-page wait times out, instead of reporting this channel as empty.
  window.IITC.comm._channelsData.faction.data = {
    f1: toProcessedEntry({ time: now, player: { name: window.PLAYER.nickname }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] })
  };

  thisplugin.MY_ACTIVITY_PAGE_TIMEOUT_MS = 10; // keep the test fast; production uses a longer real wait
  thisplugin.refreshMyActivityToday();
  assert.equal(thisplugin.myActivityState, 'loading');

  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.equal(thisplugin.myActivityState, 'done');
  assert.equal(thisplugin.myActivityToday.links, 1, 'the Faction channel\'s already-cached activity must still be counted');
});

test('getChannelLiveProcessedData: reads window.chat._public/_faction (chat.js\'s own "legacy compatibility" aliases) before window.IITC.comm._channelsData', () => {
  const { thisplugin, window } = createPluginSandbox();
  // Real chat.js keeps chat._public/_faction/_alerts as aliases of the very same objects as
  // IITC.comm._channelsData.all/faction/alerts on a modern build, but on an older build that
  // predates the IITC.comm/comm.js split, chat._public/_faction was the only real store --
  // trying it first means both eras read correctly through the same code path.
  window.chat = { _public: { data: { a1: 'from chat._public' } }, _faction: { data: { f1: 'from chat._faction' } } };
  window.IITC.comm._channelsData.all.data = { a2: 'from IITC.comm._channelsData.all' };

  assert.deepEqual(thisplugin.getChannelLiveProcessedData('all'), { a1: 'from chat._public' });
  assert.deepEqual(thisplugin.getChannelLiveProcessedData('faction'), { f1: 'from chat._faction' });
});

test('getChannelLiveProcessedData: falls back to window.IITC.comm._channelsData when window.chat has no matching store', () => {
  const { thisplugin, window } = createPluginSandbox();
  window.IITC.comm._channelsData.faction.data = { f1: 'from IITC.comm._channelsData.faction' };

  assert.deepEqual(thisplugin.getChannelLiveProcessedData('faction'), { f1: 'from IITC.comm._channelsData.faction' });
});

test('getChannelLiveProcessedData: returns null when neither store exists for this channel', () => {
  const { thisplugin, window } = createPluginSandbox();
  delete window.IITC.comm._channelsData.alerts;

  assert.equal(thisplugin.getChannelLiveProcessedData('alerts'), null);
});

test('refreshMyActivityToday: reads window.chat._public/_faction as the live-store fallback too, not just IITC.comm._channelsData', async () => {
  const { thisplugin, window } = createPluginSandbox();
  const now = Date.now();

  window.chat = {
    _faction: {
      data: {
        f1: toProcessedEntry({ time: now, player: { name: window.PLAYER.nickname }, markup: [textEntry('agent TestAgent linked from Portal A to Portal B')] })
      }
    }
  };

  thisplugin.MY_ACTIVITY_PAGE_TIMEOUT_MS = 10;
  thisplugin.refreshMyActivityToday();
  await new Promise(function (resolve) { setTimeout(resolve, 50); });

  assert.equal(thisplugin.myActivityState, 'done');
  assert.equal(thisplugin.myActivityToday.links, 1, 'the activity in chat._faction must be counted even though window.chat.requestFaction does not exist');
});
