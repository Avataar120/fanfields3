'use strict';

// stats-server/server.js protocol v2 usage details: handleCollect keeps only whitelisted
// details (normalizeDetails) while still accepting v1 pings, and aggregateAgents builds one row
// per agent with its time split by platform/mode/plan size/option and its feature use totals.

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

function tsFor(day, hour) { return Date.parse(day + 'T' + String(hour || 12).padStart(2, '0') + ':00:00Z'); }

function readStoredEvents(server) {
  const files = fs.readdirSync(server.EVENTS_DIR);
  return files.flatMap(function (f) {
    return fs.readFileSync(path.join(server.EVENTS_DIR, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  });
}

function collect(server, body, ip) {
  const req = { headers: { 'x-forwarded-for': ip || '203.0.113.7' }, socket: {} };
  const res = { status: null, writeHead(status) { this.status = status; }, end() {} };
  server.handleCollect(req, res, body);
  return res.status;
}

const AGENT_A = 'a'.repeat(64);
const AGENT_B = 'b'.repeat(64);

test('normalizeDetails: keeps known values only and caps usage counts', () => {
  const { normalizeDetails } = loadServerWithFreshDataDir();
  const out = normalizeDetails({
    platform: 'mobile', version: '7.1.0', mode: 'herringbone', plan: '11-25',
    flags: ['spendKeys', 'nope', 'sync'],
    used: { reroute: 3, keysVideo: 5000, bogus: 2, stats: -1, opLoad: 1.5 }
  });
  assert.deepEqual(out, {
    platform: 'mobile', version: '7.1.0', mode: 'herringbone', plan: '11-25',
    flags: ['spendKeys', 'sync'],
    used: { reroute: 3, keysVideo: 1000 }
  });
  assert.deepEqual(normalizeDetails({ platform: 'tablet', version: '<script>', mode: 'x', plan: '9', flags: 'sync', used: [] }), {});
});

test('handleCollect: accepts v1 and v2, rejects unknown protocol versions', () => {
  const server = loadServerWithFreshDataDir();
  assert.equal(collect(server, { v: 1, agent: AGENT_A, faction: 'ENL' }), 204);
  assert.equal(collect(server, { v: 2, agent: AGENT_B, faction: 'RES', platform: 'desktop' }), 204);
  assert.equal(collect(server, { v: 3, agent: AGENT_B, faction: 'RES' }), 426);
});

test('handleCollect: stores v2 details sanitized, and no details for v1 pings', () => {
  const server = loadServerWithFreshDataDir();
  collect(server, { v: 1, agent: AGENT_A, faction: 'ENL', platform: 'mobile' });
  collect(server, {
    v: 2, agent: AGENT_B, faction: 'RES', platform: 'mobile', version: '7.1.0', mode: 'fan',
    plan: '1-10', flags: ['taskList', 'evil'], used: { reroute: 1, hack: 9 }, extra: 'dropped'
  });
  const events = readStoredEvents(server);
  const a = events.find(function (e) { return e.agent === AGENT_A; });
  const b = events.find(function (e) { return e.agent === AGENT_B; });
  assert.equal(a.platform, undefined);
  assert.equal(b.platform, 'mobile');
  assert.deepEqual(b.flags, ['taskList']);
  assert.deepEqual(b.used, { reroute: 1 });
  assert.equal(b.extra, undefined);
});

test('aggregateAgents: splits time per platform, mode, plan and option, and sums feature uses', () => {
  const { aggregateAgents, appendEvent } = loadServerWithFreshDataDir();
  const base = { agent: AGENT_A, faction: 'ENL', region: 'west_europe', version: '7.1.0' };
  appendEvent(Object.assign({ ts: tsFor('2024-01-01', 10), seconds: 600, platform: 'desktop', mode: 'fan', plan: '11-25', flags: ['sync'] }, base));
  appendEvent(Object.assign({ ts: tsFor('2024-01-02', 10), seconds: 300, platform: 'mobile', mode: 'herringbone', plan: '1-10', flags: ['sync', 'taskList'], used: { reroute: 2 } }, base));
  appendEvent(Object.assign({ ts: tsFor('2024-01-02', 11), seconds: 60, platform: 'mobile', mode: 'herringbone', plan: '1-10', used: { reroute: 1, keysVideo: 1 } }, base));

  const res = aggregateAgents('2024-01-01', '2024-01-02', 'all', 'all');
  assert.equal(res.agents.length, 1);
  const a = res.agents[0];
  assert.equal(a.seconds, 960);
  assert.equal(a.detailedSeconds, 960);
  assert.deepEqual(a.platform, { desktop: 600, mobile: 360 });
  assert.deepEqual(a.mode, { fan: 600, herringbone: 360 });
  assert.equal(a.plan['11-25'], 600);
  assert.equal(a.plan['1-10'], 360);
  assert.equal(a.flags.sync, 900);
  assert.equal(a.flags.taskList, 300);
  assert.equal(a.used.reroute, 3);
  assert.equal(a.used.keysVideo, 1);
  assert.equal(a.daysActive, 2);
  assert.equal(a.pings, 3);
  assert.equal(a.version, '7.1.0');
  assert.deepEqual(a.byDay, [
    { date: '2024-01-01', seconds: 600, desktop: 600, mobile: 0 },
    { date: '2024-01-02', seconds: 360, desktop: 0, mobile: 360 }
  ]);
});

test('aggregateAgents: v1 events count in total time but not in any split', () => {
  const { aggregateAgents, appendEvent } = loadServerWithFreshDataDir();
  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 500 });
  appendEvent({ ts: tsFor('2024-01-01', 13), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 100, platform: 'mobile', mode: 'fan', plan: '0' });

  const a = aggregateAgents('2024-01-01', '2024-01-01', 'all', 'all').agents[0];
  assert.equal(a.seconds, 600);
  assert.equal(a.detailedSeconds, 100);
  assert.deepEqual(a.platform, { desktop: 0, mobile: 100 });
  assert.equal(a.version, null);
});

test('aggregateAgents: sorted by active time, with faction and region filters applied', () => {
  const { aggregateAgents, appendEvent } = loadServerWithFreshDataDir();
  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_A, faction: 'ENL', region: 'west_europe', seconds: 100 });
  appendEvent({ ts: tsFor('2024-01-01'), agent: AGENT_B, faction: 'RES', region: 'north_america', seconds: 900 });

  assert.deepEqual(aggregateAgents('2024-01-01', '2024-01-01', 'all', 'all').agents.map(function (a) { return a.agent; }), [AGENT_B, AGENT_A]);
  assert.deepEqual(aggregateAgents('2024-01-01', '2024-01-01', 'ENL', 'all').agents.map(function (a) { return a.agent; }), [AGENT_A]);
  assert.deepEqual(aggregateAgents('2024-01-01', '2024-01-01', 'all', 'north_america').agents.map(function (a) { return a.agent; }), [AGENT_B]);
});
