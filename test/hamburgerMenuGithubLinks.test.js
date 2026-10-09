'use strict';

// The hamburger menu's last two entries, "Give me a star" and "Report a bug", must open the
// plugin's own GitHub repo and its issues page -- in that order, as the two final entries.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

function getMenuEntries(thisplugin) {
  let capturedEntries = null;
  thisplugin.buildPopupMenu = function (entries) { capturedEntries = entries; };

  thisplugin.showMainMenu({ getBoundingClientRect() { return { bottom: 0, left: 0 }; } });

  return capturedEntries;
}

test('hamburger menu ends with "Give me a star" then "Report a bug"', () => {
  const { thisplugin } = createPluginSandbox();
  const entries = getMenuEntries(thisplugin);

  const lastTwo = entries.slice(-2);
  assert.equal(lastTwo[0].label, 'Give&nbsp;me&nbsp;a&nbsp;star');
  assert.equal(lastTwo[1].label, 'Report&nbsp;a&nbsp;bug');
});

test('"Give me a star" opens the plugin\'s GitHub repo', () => {
  const { thisplugin, window } = createPluginSandbox();
  const entries = getMenuEntries(thisplugin);

  entries[entries.length - 2].action();

  assert.equal(window._opened.length, 1);
  assert.equal(window._opened[0].url, 'https://github.com/Avataar120/fanfields3');
  assert.equal(window._opened[0].target, '_blank');
});

test('"Report a bug" opens the plugin\'s GitHub issues page', () => {
  const { thisplugin, window } = createPluginSandbox();
  const entries = getMenuEntries(thisplugin);

  entries[entries.length - 1].action();

  assert.equal(window._opened.length, 1);
  assert.equal(window._opened[0].url, 'https://github.com/Avataar120/fanfields3/issues');
  assert.equal(window._opened[0].target, '_blank');
});
