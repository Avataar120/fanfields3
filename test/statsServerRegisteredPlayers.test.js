'use strict';

// stats-server/server.js aggregate()'s byDay.registeredTotal: a cumulative count of distinct
// agents ever seen (by faction/region filter) as of each day -- "registered players", which can
// only grow. It must keep counting from the very start of the stored history even when the
// requested `from` date starts later (see firstSeenDayByAgent in server.js), not reset at the
// start of the selected range.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// server.js reads DATA_DIR once at require time, so each test gets its own fresh temp directory
// and its own fresh require (the module cache is cleared first).
function loadServerWithFreshDataDir() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanfields-stats-test-'));
  process.env.DATA_DIR = dataDir;
  const serverPath = require.resolve('../stats-server/server.js');
  delete require.cache[serverPath];
  return require(serverPath);
}

function tsFor(day) { return Date.parse(day + 'T12:00:00Z'); }

const AGENT_A = 'a'.repeat(64);
const AGENT_B = 'b'.repeat(64);
const AGENT_C = 'c'.repeat(64);

test('aggregate: registeredTotal is a running cumulative count of distinct agents, by day', () => {
  const { aggregate, appendEvent } = loadServerWithFreshDataDir();

  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 0 });
  appendEvent({ ts: tsFor('2024-01-02'), agent: AGENT_B, faction: 'RES', region: 'north_america', seconds: 0 });
  appendEvent({ ts: tsFor('2024-01-02'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 60 });
  appendEvent({ ts: tsFor('2024-01-03'), agent: AGENT_C, faction: 'ENL', region: 'west_europe', seconds: 0 });

  const res = aggregate('2024-01-01', '2024-01-03', 'all', 'all');
  assert.deepEqual(res.byDay.map(function (d) { return d.registeredTotal; }), [1, 2, 3]);
});

test('aggregate: registeredTotal keeps counting agents first seen before the requested `from`', () => {
  const { aggregate, appendEvent } = loadServerWithFreshDataDir();

  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 0 });
  appendEvent({ ts: tsFor('2024-01-02'), agent: AGENT_B, faction: 'RES', region: 'north_america', seconds: 0 });
  appendEvent({ ts: tsFor('2024-01-03'), agent: AGENT_C, faction: 'ENL', region: 'west_europe', seconds: 0 });

  // Asking only for the last two days must still count AGENT_A, registered before the range.
  const res = aggregate('2024-01-02', '2024-01-03', 'all', 'all');
  assert.deepEqual(res.byDay.map(function (d) { return d.registeredTotal; }), [2, 3]);
});

test('aggregate: registeredTotal under a faction filter only counts that faction\'s own agents', () => {
  const { aggregate, appendEvent } = loadServerWithFreshDataDir();

  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 0 });
  appendEvent({ ts: tsFor('2024-01-02'), agent: AGENT_B, faction: 'RES', region: 'north_america', seconds: 0 });
  appendEvent({ ts: tsFor('2024-01-03'), agent: AGENT_C, faction: 'ENL', region: 'west_europe', seconds: 0 });

  const res = aggregate('2024-01-01', '2024-01-03', 'ENL', 'all');
  assert.deepEqual(res.byDay.map(function (d) { return d.registeredTotal; }), [1, 1, 2]);
});

test('aggregate: a day with no new agent repeats the previous day\'s registeredTotal (never decreases)', () => {
  const { aggregate, appendEvent } = loadServerWithFreshDataDir();

  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 0 });
  // 2024-01-02: no events at all.
  appendEvent({ ts: tsFor('2024-01-03'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 60 });

  const res = aggregate('2024-01-01', '2024-01-03', 'all', 'all');
  assert.deepEqual(res.byDay.map(function (d) { return d.registeredTotal; }), [1, 1, 1]);
});
