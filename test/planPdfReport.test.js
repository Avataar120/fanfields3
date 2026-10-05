'use strict';

// PR #43 ("Export plan PDF") added thisplugin.buildPlanPdfHtml/escapeHtml with zero automated
// coverage: exportPlanPdf() itself needs a browser (alert/window.saveFile/window.open), but the
// report-building logic it calls is plain, DOM-free string building over the same `order` +
// thisplugin.simulateWalk() data every other "Less walking" test already drives through
// buildPlan() -- so it's just as testable in this sandbox as the walk-order checks are.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixturePortals, buildPlan } = require('./support/planFixtures');

const portals = loadFixturePortals('orly-76-portals.json');

test('escapeHtml: escapes every HTML-significant character, leaves everything else alone', () => {
  const { thisplugin } = require('./support/pluginSandbox').createPluginSandbox();
  assert.equal(thisplugin.escapeHtml('<Portal> "Fan&Fields" 3'),
    '&lt;Portal&gt; &quot;Fan&amp;Fields&quot; 3');
  assert.equal(thisplugin.escapeHtml('Plain Portal Name 42'), 'Plain Portal Name 42');
});

['inbound', 'outbound'].forEach(function (mode) {
  test('buildPlanPdfHtml (' + mode + '): one page per walk step, in the real walk order', async () => {
    const plan = await buildPlan(portals, { mode: mode, anchorGuid: portals[0].guid });
    const html = plan.thisplugin.buildPlanPdfHtml(plan.walkOrder);

    const pageCount = (html.match(/class="ff3-pdf-page"/g) || []).length;
    assert.equal(pageCount, plan.walkOrder.length,
      'every portal in the walk order must get exactly one report page');

    const stepTitles = Array.from(html.matchAll(/Step (\d+) \/ (\d+)/g)).map(function (m) { return Number(m[1]); });
    assert.deepEqual(stepTitles, Array.from(plan.walkOrder, function (_fp, i) { return i + 1; }),
      'step numbers must follow the walk order exactly, not be reordered or skipped');

    // Step numbers alone would pass even if the pages themselves were reordered (they're just
    // the loop index) -- comparing the portal title printed on each page catches that.
    const printedPortals = Array.from(html.matchAll(/ff3-pdf-portal">Portal: ([^<]*)</g)).map(function (m) { return m[1]; });
    // Real fixture titles can contain '&'/'"'/etc. (e.g. 'fresque "french"'), escaped in the
    // report itself -- escape the expected side the same way rather than comparing raw to escaped.
    const expectedPortals = Array.from(plan.walkOrder, function (fp) { return plan.thisplugin.escapeHtml(fp.portal.options.data.title); });
    assert.deepEqual(printedPortals, expectedPortals,
      'the portal named on each report page must follow the real walk order');
  });

  test('buildPlanPdfHtml (' + mode + '): field counts per link are never negative and sum to the plan\'s own field total', async () => {
    const plan = await buildPlan(portals, { mode: mode, anchorGuid: portals[0].guid });
    const thisplugin = plan.thisplugin;
    const walk = thisplugin.simulateWalk(plan.walkOrder);
    const html = thisplugin.buildPlanPdfHtml(plan.walkOrder);

    // "(N field)" / "(N fields)" is the only place a per-link field count is printed.
    const printedCounts = Array.from(html.matchAll(/\((\d+) fields?\)/g)).map(function (m) { return Number(m[1]); });
    printedCounts.forEach(function (n) {
      assert.ok(n >= 0, 'a link can never be printed as completing a negative number of fields');
    });
    const totalPrinted = printedCounts.reduce(function (a, b) { return a + b; }, 0);
    assert.equal(totalPrinted, walk.triangles.length,
      'every field the walk actually forms must be attributed to exactly one printed link, with none double-counted or dropped');
  });

  test('buildPlanPdfHtml (' + mode + '): cumulative distance never decreases step to step', async () => {
    const plan = await buildPlan(portals, { mode: mode, anchorGuid: portals[0].guid });
    const html = plan.thisplugin.buildPlanPdfHtml(plan.walkOrder);

    const cumulative = Array.from(html.matchAll(/Cumulative distance walked: (\d+) m/g))
      .map(function (m) { return Number(m[1]); });
    assert.equal(cumulative.length, plan.walkOrder.length);
    for (let i = 1; i < cumulative.length; i++) {
      assert.ok(cumulative[i] >= cumulative[i - 1],
        'walking backwards in cumulative distance would mean the report mis-ordered its own steps');
    }
  });
});

test('buildPlanPdfHtml: a portal title with HTML-significant characters is escaped, not injected raw', async () => {
  const customPortals = portals.slice(0, 6).map(function (p, i) {
    return i === 0 ? Object.assign({}, p, { title: 'Portal <3> & "Co"' }) : p;
  });
  const plan = await buildPlan(customPortals, { mode: 'inbound', anchorGuid: customPortals[0].guid });
  const html = plan.thisplugin.buildPlanPdfHtml(plan.walkOrder);

  assert.ok(!html.includes('Portal <3> & "Co"'),
    'the raw title must never appear unescaped in the generated HTML report');
  assert.ok(html.includes('Portal &lt;3&gt; &amp; &quot;Co&quot;'),
    'the escaped form of the title must be present instead');
});
