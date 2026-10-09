'use strict';

// On mobile, tapping an element that carries a title attribute pops up a native browser
// tooltip instead of just registering the tap (see thisplugin.wireTaskListHandlers for the
// same issue in the Task List dialog). The map's hamburger menu button carries one too
// ("Fan Fields 3 - Menu"), so it must be stripped on mobile while desktop keeps its hover
// tooltip.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

function buildHamburgerButton(isMobile) {
  const { thisplugin, window, L, $ } = createPluginSandbox();
  L.Browser.mobile = isMobile;

  let addedControl = null;
  window.map.addControl = function (control) { addedControl = control; };

  thisplugin.addFfButtons();
  addedControl.onAdd(window.map);

  return $.__registry.get('fanfieldMenuButton');
}

test('hamburger menu button keeps its title tooltip on desktop', () => {
  const entry = buildHamburgerButton(false);
  assert.equal(entry.title, 'Fan Fields 3 - Menu');
});

test('hamburger menu button loses its title tooltip on mobile (no native tap hint)', () => {
  const entry = buildHamburgerButton(true);
  assert.equal(entry.title, undefined);
});
