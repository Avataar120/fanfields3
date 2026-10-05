// Loads the real iitc_plugin_fanfields3.user.js source into an isolated Node `vm` context,
// with just enough of the browser/IITC/Leaflet/jQuery surface stubbed out for the plugin's own
// top-level code (inside `function wrapper(plugin_info) { ... }`) to run without throwing.
//
// The script is never modified: this file extracts the wrapper function's exact source between
// its `function wrapper(plugin_info) {` and `} // wrapper end` markers, evaluates it in the
// sandbox, then calls `wrapper({})` itself -- skipping the real file's own trailing
// "inject a <script> tag into the page" dance, which only exists to escape a Tampermonkey
// sandbox and has no equivalent (or purpose) here.
//
// `window.iitcLoaded` is left falsy, so the plugin's own `setup()` is never auto-invoked --
// most tests only need the plain functions/constants `wrapper()` attaches to
// `window.plugin.fanfields` (returned here as `thisplugin`), not the DOM wiring `setup()` does.
// A test that needs `setup()` (or `updateLayer()`, which reads `window.plugin.drawTools`,
// `window.portals`, `window.links`, etc.) adds those stubs itself, after `createPluginSandbox()`.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLUGIN_SOURCE_PATH = path.join(__dirname, '..', '..', 'iitc_plugin_fanfields3.user.js');
const WRAPPER_START = 'function wrapper(plugin_info) {';
const WRAPPER_END = '} // wrapper end';

let cachedWrapperSource = null;

function extractWrapperSource() {
  if (cachedWrapperSource) return cachedWrapperSource;
  const fullSource = fs.readFileSync(PLUGIN_SOURCE_PATH, 'utf8');
  const startIdx = fullSource.indexOf(WRAPPER_START);
  const endIdx = fullSource.indexOf(WRAPPER_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Could not find the wrapper() function markers in ' + PLUGIN_SOURCE_PATH +
      ' -- the test harness extracts its exact source and needs to be updated if those markers move.');
  }
  cachedWrapperSource = fullSource.slice(startIdx, endIdx + WRAPPER_END.length);
  return cachedWrapperSource;
}

// A tiny, in-memory localStorage: same synchronous get/set/remove/clear/key/length surface the
// plugin itself uses, backed by a plain Map so a test can inspect/seed it directly.
function createLocalStorage() {
  const store = new Map();
  return {
    __store: store,
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    key(index) { return Array.from(store.keys())[index] ?? null; },
    get length() { return store.size; }
  };
}

// Leaflet's L.LatLng is extended in place by the plugin itself (thisplugin.initLatLng()), so the
// stub only needs to support what map.project/unproject and distanceTo actually use: plain
// lat/lng fields plus a Euclidean distanceTo. The plugin's own map.project/unproject stubs below
// keep a flat (lat=y, lng=x) round trip, so this distance is consistent with every projected
// point the plugin computes with it -- not geographically accurate, which no test here needs.
class FakeLatLng {
  constructor(lat, lng) {
    this.lat = lat;
    this.lng = lng;
  }
  distanceTo(other) {
    const dLat = this.lat - other.lat;
    const dLng = this.lng - other.lng;
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }
  equals(other) {
    return !!other && this.lat === other.lat && this.lng === other.lng;
  }
}

class FakePoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  equals(other) {
    return !!other && this.x === other.x && this.y === other.y;
  }
}

function createMapStub() {
  return {
    project(latlng, _zoom) { return new FakePoint(latlng.lng, latlng.lat); },
    unproject(point, _zoom) { return new FakeLatLng(point.y, point.x); },
    getZoom() { return 17; },
    getCenter() { return new FakeLatLng(0, 0); },
    getBounds() { return { contains() { return true; } }; },
    // Always "shown": updateLayer() early-returns while none of its own three layer groups are
    // on the map, which no test here has any reason to exercise.
    hasLayer() { return true; },
    on() {},
    off() {},
    addControl() {},
    invalidateSize() {},
    panTo() {},
    latLngToLayerPoint(ll) { return new FakePoint(ll.lng, ll.lat); },
    layerPointToLatLng(p) { return new FakeLatLng(p.y, p.x); }
  };
}

// Minimal L namespace: just enough of Leaflet's surface for the plugin's top-level code (which
// only *extends* L.LatLng.prototype and *reads* a few constants/classes, never instantiates a
// real map) to load without throwing, plus what individual tests construct directly (L.marker,
// L.polyline, L.LayerGroup, ...) as inert no-op stand-ins.
function createLeafletStub() {
  function NoopLayer() {
    return {
      addTo() { return this; },
      removeFrom() { return this; },
      setLatLng() { return this; },
      setLatLngs() { return this; },
      clearLayers() { return this; }
    };
  }
  const L = {
    LatLng: FakeLatLng,
    Point: FakePoint,
    latLng(lat, lng) { return new FakeLatLng(lat, lng); },
    marker: NoopLayer,
    polyline: NoopLayer,
    polygon: NoopLayer,
    circleMarker: NoopLayer,
    divIcon(opts) { return opts; },
    LayerGroup: function () {
      const layers = [];
      return {
        addTo() { return this; },
        addLayer(l) { layers.push(l); return this; },
        removeLayer(l) { const i = layers.indexOf(l); if (i !== -1) layers.splice(i, 1); return this; },
        clearLayers() { layers.length = 0; return this; },
        getLayers() { return layers.slice(); }
      };
    },
    Control: { extend(def) { return function () { return Object.assign({}, def); }; } },
    DomUtil: { create() { return { classList: { add() {}, remove() {} }, style: {} }; } },
    DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {}, on() {}, stop() {} },
    Browser: { mobile: false },
    extend(target) {
      const sources = Array.prototype.slice.call(arguments, 1);
      sources.forEach(function (s) { Object.assign(target, s); });
      return target;
    },
    GeodesicPolygon: function () {},
    GeodesicPolyline: function () {},
    GeodesicCircle: function () {},
    Polygon: function () {},
    Polyline: function () {},
    Circle: function () {},
    Marker: function () {}
  };
  return L;
}

// A tiny jQuery-like stand-in: supports the handful of calls the plugin's own TOP-LEVEL code
// (not setup()/DOM-building code, which individual tests stub further if they need it) might
// reach through helpers. Chaining always returns an object with every method a test or the
// plugin might call, each a no-op unless noted.
function createJqueryStub() {
  function jq() {
    const el = {
      length: 0,
      each() { return el; },
      on() { return el; },
      off() { return el; },
      attr() { return el; },
      val() { return el; },
      text() { return el; },
      html() { return el; },
      css() { return el; },
      find() { return jq(); },
      append() { return el; },
      prepend() { return el; },
      empty() { return el; },
      remove() { return el; },
      is() { return false; },
      prop() { return el; },
      closest() { return jq(); },
      toggleClass() { return el; },
      addClass() { return el; },
      removeAttr() { return el; },
      trigger() { return el; }
    };
    return el;
  }
  jq.extend = Object.assign;
  // jQuery.each: object form calls back(key, value) for own enumerable keys, array form
  // calls back(index, value) -- same signature the plugin's own $.each(window.portals, ...)
  // and $.each(donelinks, ...) calls rely on.
  jq.each = function (collection, callback) {
    if (Array.isArray(collection)) {
      collection.forEach(function (value, index) { callback(index, value); });
    } else if (collection) {
      Object.keys(collection).forEach(function (key) { callback(key, collection[key]); });
    }
    return collection;
  };
  return jq;
}

// Builds a fresh sandbox, evaluates the plugin's wrapper() source in it, and calls wrapper({})
// -- same as the real file's own tail does, minus the Tampermonkey script-injection step (see
// the file-level comment above). Returns { thisplugin, window, localStorage, context } so a
// test can both call plugin functions and inspect/seed the stubs it ran against.
function createPluginSandbox() {
  const localStorage = createLocalStorage();
  const L = createLeafletStub();
  const $ = createJqueryStub();

  const sandboxWindow = {
    PLAYER: { team: 'RESISTANCE', nickname: 'TestAgent' },
    TEAM_NONE: 0, TEAM_RES: 1, TEAM_ENL: 2, TEAM_MAC: 3,
    TEAM_CODENAMES: ['NEUTRAL', 'RESISTANCE', 'ENLIGHTENED', 'MACHINA'],
    TEAM_CODES: ['N', 'R', 'E', 'M'],
    portals: {},
    links: {},
    fields: {},
    escapeHtmlSpecialChars(s) { return String(s); },
    formatDistance(d) { return d + ' m'; },
    // A real, minimal pub/sub (not a no-op): thisplugin.refreshMyActivityToday both registers
    // and later removes its own per-channel listener, and a test needs to actually invoke a
    // registered callback to simulate a Comm page arriving -- a no-op addHook couldn't support
    // either. _hookListeners is also exposed directly so a test can fire a hook itself
    // (window._hookListeners['factionChatDataAvailable'][0](data)) without IITC.comm actually
    // being a real implementation.
    _hookListeners: {},
    addHook(name, cb) {
      (sandboxWindow._hookListeners[name] = sandboxWindow._hookListeners[name] || []).push(cb);
    },
    removeHook(name, cb) {
      const listeners = sandboxWindow._hookListeners[name];
      if (!listeners) return;
      const i = listeners.indexOf(cb);
      if (i !== -1) listeners.splice(i, 1);
    },
    // Records every requestChannel call (channel, olderMsgs) so a test can assert which
    // channels/pages were actually requested; it never calls back on its own -- a test fires
    // the matching hook (see _hookListeners above) to simulate the server's response.
    _commRequests: [],
    IITC: {
      comm: {
        requestChannel(channel, olderMsgs) {
          sandboxWindow._commRequests.push({ channel, olderMsgs });
        },
        // IITC.comm's own already-accumulated per-channel store (comm.js _channelsData) --
        // real IITC keeps this current even when a request comes back with nothing new to add
        // (no hook fires then; see comm.js _handleChannel), which is exactly the case
        // thisplugin.getChannelLiveProcessedData reads this directly to cover. A test seeds
        // `window.IITC.comm._channelsData[channel].data` to simulate "IITC already has this
        // cached" independently of firing a channel's own hook.
        _channelsData: { all: { data: {} }, faction: { data: {} }, alerts: { data: {} } }
      }
    },
    pluginCreateHook() {},
    runHooks() {},
    addLayerGroup() {},
    bootPlugins: [],
    iitcLoaded: false
  };
  sandboxWindow.window = sandboxWindow;

  const documentStub = {
    createElement() {
      return { style: {}, classList: { add() {}, remove() {} }, appendChild() {} };
    },
    createTextNode(text) { return { text }; },
    addEventListener() {},
    getElementById() { return null; },
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    body: { appendChild() {} }
  };

  const mapStub = createMapStub();
  sandboxWindow.map = mapStub; // the plugin reads it as window.map, never a bare global

  const context = vm.createContext({
    window: sandboxWindow,
    document: documentStub,
    localStorage,
    console,
    // geolocation always fails, but asynchronously (a real Geolocation API never answers
    // synchronously) -- thisplugin.getPlayerPosition's fallback chain ends up calling back
    // into plan redraw code, and answering synchronously here would re-enter it from within
    // the very same call stack that triggered it, overflowing the stack.
    navigator: {
      hardwareConcurrency: 4,
      geolocation: {
        getCurrentPosition(_success, error) {
          setTimeout(function () { if (error) error(new Error('no geolocation in tests')); }, 0);
        }
      },
      sendBeacon: undefined
    },
    L,
    $,
    jQuery: $,
    map: mapStub,
    plugin: sandboxWindow.plugin,
    dialog() {},
    Promise,
    Set,
    Map,
    Date,
    Math,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL: typeof URL !== 'undefined' ? URL : undefined,
    TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : undefined,
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined,
    crypto: typeof crypto !== 'undefined' ? crypto : undefined
  });
  // `plugin` (lowercase, used as `plugin.drawTools.drawnItems` by updateLayer()) is read off the
  // sandbox's own `window.plugin` once wrapper() has set it to a function -- re-point it so the
  // two names stay the exact same object, the way a real page's implicit globals would.
  vm.runInContext('plugin = window.plugin;', context);

  vm.runInContext(extractWrapperSource(), context, { filename: 'iitc_plugin_fanfields3.wrapper.js' });
  vm.runInContext('wrapper({}); plugin = window.plugin;', context, { filename: 'iitc_plugin_fanfields3.boot.js' });

  const thisplugin = sandboxWindow.plugin.fanfields;
  if (!thisplugin) {
    throw new Error('wrapper({}) ran but window.plugin.fanfields was never set -- check the sandbox stubs above.');
  }

  // `portals` and `links` (bare, no "window." prefix) are how updateLayer()'s own buildFanPlan
  // reads them (IITC's real implicit globals) -- re-synced on demand after a test reassigns
  // window.portals/window.links, since a vm context's bare identifier binding doesn't follow a
  // later `window.portals = ...` the way a real page's `window.portals` alias would.
  function syncBareGlobals() {
    vm.runInContext('portals = window.portals; links = window.links; plugin = window.plugin;', context);
  }
  syncBareGlobals();

  return { thisplugin, window: sandboxWindow, localStorage, context, L, $, syncBareGlobals };
}

// Array/object literals created by code running inside the vm context belong to that context's
// own JS realm, which Node's assert.deepStrictEqual refuses to consider equal to an otherwise
// identical host-realm array/object (it throws "same structure but not reference-equal"). Array
// methods invoked as plain functions (not through a foreign `this`) always construct in the
// REALM OF THE FUNCTION ITSELF, so calling the host's own Array.from on a vm-realm array yields
// a plain host-realm array a test can safely compare with assert.deepEqual.
function toHostArray(maybeForeignArray) {
  return Array.from(maybeForeignArray);
}

module.exports = { createPluginSandbox, FakeLatLng, FakePoint, toHostArray };
