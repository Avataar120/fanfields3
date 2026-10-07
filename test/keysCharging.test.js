'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox, toHostArray } = require('./support/pluginSandbox');

function makeKeysPlugin(initial) {
  const keys = Object.assign({}, initial);
  return {
    keys,
    addKey(delta, guid) {
      keys[guid] = (keys[guid] || 0) + delta;
    }
  };
}

function freshSandbox() {
  const sandbox = createPluginSandbox();
  sandbox.thisplugin._mapDataLoading = false; // most of this suite is past the "still loading" gate
  return sandbox;
}

// thisplugin.getChargedLinkGuids() may return an array built inside the sandbox's own vm realm
// (see toHostArray's own comment) -- always go through this before a deepEqual.
function charged(thisplugin) {
  return toHostArray(thisplugin.getChargedLinkGuids()).sort();
}

test('getChargedLinkGuids: empty when nothing stored, and reads back what was stored', () => {
  const { thisplugin, localStorage } = freshSandbox();
  assert.deepEqual(charged(thisplugin), []);
  localStorage.setItem(thisplugin.CHARGED_LINKS_STORAGE_KEY, JSON.stringify(['a', 'b']));
  assert.deepEqual(charged(thisplugin), ['a', 'b']);
});

test('getChargedLinkGuids: tolerates corrupt/non-array JSON instead of throwing', () => {
  const { thisplugin, localStorage } = freshSandbox();
  localStorage.setItem(thisplugin.CHARGED_LINKS_STORAGE_KEY, 'not json at all');
  assert.deepEqual(charged(thisplugin), []);
  localStorage.setItem(thisplugin.CHARGED_LINKS_STORAGE_KEY, JSON.stringify({ not: 'an array' }));
  assert.deepEqual(charged(thisplugin), []);
});

test('markLinkGuidsCharged: adds new guids and de-duplicates already-known ones', () => {
  const { thisplugin } = freshSandbox();
  thisplugin.markLinkGuidsCharged(['g1', 'g2']);
  thisplugin.markLinkGuidsCharged(['g2', 'g3']);
  assert.deepEqual(charged(thisplugin), ['g1', 'g2', 'g3']);
});

test('markLinkGuidsCharged: merges with a value written directly into localStorage since the ' +
  'last read, instead of overwriting it -- this is exactly what keeps a set pulled in by Simple ' +
  'Cloud Sync from another device from being clobbered by a stale in-memory copy', () => {
  const { thisplugin, localStorage } = freshSandbox();
  thisplugin.markLinkGuidsCharged(['fromThisDevice']);

  // Simulate Simple Cloud Sync applying a remote update straight into localStorage, the same
  // way its own applySyncResult() does (see IITC-Synchro) -- bypassing any of this plugin's
  // own functions entirely.
  localStorage.setItem(thisplugin.CHARGED_LINKS_STORAGE_KEY, JSON.stringify(['fromThisDevice', 'fromOtherDevice']));

  thisplugin.markLinkGuidsCharged(['fromThisDeviceAgain']);
  assert.deepEqual(charged(thisplugin), ['fromOtherDevice', 'fromThisDevice', 'fromThisDeviceAgain'].sort());
});

test('markLinkGuidsCharged: writes nothing when every guid given is already charged (no-op write)', () => {
  const { thisplugin, localStorage } = freshSandbox();
  thisplugin.markLinkGuidsCharged(['g1']);
  const before = localStorage.getItem(thisplugin.CHARGED_LINKS_STORAGE_KEY);
  thisplugin.markLinkGuidsCharged(['g1']);
  assert.equal(localStorage.getItem(thisplugin.CHARGED_LINKS_STORAGE_KEY), before);
});

test('markLinkGuidsCharged: trims the oldest entries once CHARGED_LINKS_MAX is exceeded', () => {
  const { thisplugin } = freshSandbox();
  thisplugin.CHARGED_LINKS_MAX = 3;
  thisplugin.markLinkGuidsCharged(['g1', 'g2', 'g3', 'g4']);
  const stored = toHostArray(thisplugin.getChargedLinkGuids());
  assert.equal(stored.length, 3);
  assert.deepEqual(stored, ['g2', 'g3', 'g4']);
});

test('chargeNewlyThrownLinks: does nothing at all while the map is still loading', () => {
  const { thisplugin, localStorage, window } = freshSandbox();
  thisplugin._mapDataLoading = true;
  window.plugin.keys = makeKeysPlugin({ destA: 5 });

  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);

  assert.equal(localStorage.getItem(thisplugin.CHARGING_INITIALIZED_KEY), null);
  assert.equal(window.plugin.keys.keys.destA, 5);
});

test('chargeNewlyThrownLinks: first run ever seeds existing links as already-charged, without spending any key', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 5, destB: 2 });

  thisplugin.chargeNewlyThrownLinks([
    { linkGuid: 'l1', destGuid: 'destA' },
    { linkGuid: 'l2', destGuid: 'destB' }
  ]);

  assert.equal(window.plugin.keys.keys.destA, 5);
  assert.equal(window.plugin.keys.keys.destB, 2);
  assert.deepEqual(charged(thisplugin), ['l1', 'l2']);
});

test('chargeNewlyThrownLinks: defers first-run seeding while Simple Cloud Sync is still pulling its initial sync', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 5 });
  window.plugin.simpleCloudSync = { initialSyncPending: true };

  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);

  assert.deepEqual(charged(thisplugin), []); // not seeded yet
  assert.equal(window.plugin.keys.keys.destA, 5);
});

test('chargeNewlyThrownLinks: proceeds with first-run seeding once Simple Cloud Sync\'s initial sync has landed', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 5 });
  window.plugin.simpleCloudSync = { initialSyncPending: true };

  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.deepEqual(charged(thisplugin), []);

  window.plugin.simpleCloudSync.initialSyncPending = false;
  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.deepEqual(charged(thisplugin), ['l1']);
});

test('chargeNewlyThrownLinks: proceeds anyway once the cross-device sync grace period has elapsed, ' +
  'so a Simple Cloud Sync install that is present but never configured does not block seeding forever', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 5 });
  window.plugin.simpleCloudSync = { initialSyncPending: true };
  thisplugin._loadedAt = Date.now() - (thisplugin.CROSS_DEVICE_SYNC_GRACE_MS + 1000);

  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.deepEqual(charged(thisplugin), ['l1']);
});

test('chargeNewlyThrownLinks: once initialized, a genuinely new link spends exactly one key and is then remembered', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 3 });

  // First run: seed with nothing yet in-game.
  thisplugin.chargeNewlyThrownLinks([]);

  // A link now appears -- this is the first time it's ever been seen, so it's a real new throw.
  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.equal(window.plugin.keys.keys.destA, 2);
  assert.deepEqual(charged(thisplugin), ['l1']);

  // Seeing the very same link again (e.g. the next recalculation) must never spend a second key.
  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.equal(window.plugin.keys.keys.destA, 2);
});

test('chargeNewlyThrownLinks: never spends a key below 0', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 0 });
  thisplugin.chargeNewlyThrownLinks([]); // seed empty

  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.equal(window.plugin.keys.keys.destA, 0);
  // Still remembered as charged, even though there was nothing to actually decrement.
  assert.deepEqual(charged(thisplugin), ['l1']);
});

test('chargeNewlyThrownLinks: the "Spend keys on throw" toggle fully disables charging', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.keys = makeKeysPlugin({ destA: 3 });
  thisplugin.chargeNewlyThrownLinks([]); // seed empty
  thisplugin.consumeKeysOnLinkThrown = false;

  thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  assert.equal(window.plugin.keys.keys.destA, 3);
  assert.deepEqual(charged(thisplugin), []);
});

test('chargeNewlyThrownLinks: without the Keys plugin installed, nothing is charged (and nothing throws)', () => {
  const { thisplugin, window } = freshSandbox();
  delete window.plugin.keys;
  thisplugin.chargeNewlyThrownLinks([]); // seed empty

  assert.doesNotThrow(() => {
    thisplugin.chargeNewlyThrownLinks([{ linkGuid: 'l1', destGuid: 'destA' }]);
  });
  assert.deepEqual(charged(thisplugin), []);
});

test('isCrossDeviceSyncPending: false when Simple Cloud Sync is not installed', () => {
  const { thisplugin, window } = freshSandbox();
  delete window.plugin.simpleCloudSync;
  assert.equal(thisplugin.isCrossDeviceSyncPending(), false);
});

test('isCrossDeviceSyncPending: false once Simple Cloud Sync reports its initial sync is done', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.simpleCloudSync = { initialSyncPending: false };
  assert.equal(thisplugin.isCrossDeviceSyncPending(), false);
});

test('isCrossDeviceSyncPending: true while pending and within the grace period, false past it', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.simpleCloudSync = { initialSyncPending: true };
  assert.equal(thisplugin.isCrossDeviceSyncPending(), true);

  thisplugin._loadedAt = Date.now() - (thisplugin.CROSS_DEVICE_SYNC_GRACE_MS + 1);
  assert.equal(thisplugin.isCrossDeviceSyncPending(), false);
});

test('defaultConsumeKeysOnLinkThrown: false when Simple Cloud Sync is not installed', () => {
  const { thisplugin, window } = freshSandbox();
  delete window.plugin.simpleCloudSync;
  assert.equal(thisplugin.defaultConsumeKeysOnLinkThrown(), false);
});

test('defaultConsumeKeysOnLinkThrown: true once Simple Cloud Sync is installed', () => {
  const { thisplugin, window } = freshSandbox();
  window.plugin.simpleCloudSync = { initialSyncPending: false };
  assert.equal(thisplugin.defaultConsumeKeysOnLinkThrown(), true);
});
