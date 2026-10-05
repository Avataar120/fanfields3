'use strict';

// Covers two small, easy-to-silently-break changes made when "Print" and "Walk sim" moved out
// of the Task List into the hamburger menu's new "Plan details" submenu, and "Walk sim links"
// stopped being a togglable option (it's always on now):
//  - the Task List's own HTML no longer offers a Print button (moved to Plan details);
//  - an older saved op/default that still carries walkSimShowLinks (now a dead field) must not
//    be able to turn the always-on behavior back off when it's loaded.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixturePortals, buildPlan } = require('./support/planFixtures');

const portals = loadFixturePortals('orly-76-portals.json');

test('buildTaskListHTML: no Print button (moved to the hamburger menu\'s Plan details submenu)', async () => {
  const plan = await buildPlan(portals, { mode: 'inbound', anchorGuid: portals[0].guid });
  const html = plan.thisplugin.buildTaskListHTML();

  assert.ok(!html.includes('plugin_fanfields3_export_pdf_btn'),
    'the Task List must not render its own Print button any more');
  assert.ok(html.includes('plugin_fanfields3_reset_link_flips_btn'),
    '"Reset link orders" is unrelated to this change and must still be there');
});

test('applyOptionsSnapshot: an old saved walkSimShowLinks:false no longer disables it (always on now)', () => {
  const { thisplugin } = require('./support/pluginSandbox').createPluginSandbox();

  assert.equal(thisplugin.walkSimShowLinks, true, 'defaults on');
  thisplugin.applyOptionsSnapshot({ walkSimShowLinks: false, availableSBUL: 3 });

  assert.equal(thisplugin.walkSimShowLinks, true,
    'a legacy saved value must be ignored, not turn the now-permanent behavior back off');
  assert.equal(thisplugin.availableSBUL, 3, 'other fields in the same snapshot still apply normally');
});
