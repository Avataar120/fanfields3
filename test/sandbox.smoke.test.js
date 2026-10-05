'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginSandbox } = require('./support/pluginSandbox');

test('the real plugin source loads in the sandbox and exposes window.plugin.fanfields', () => {
  const { thisplugin } = createPluginSandbox();
  assert.equal(typeof thisplugin, 'function');
  assert.equal(typeof thisplugin.pointPairKey, 'function');
  assert.equal(thisplugin.PROJECT_ZOOM, 16);
});
