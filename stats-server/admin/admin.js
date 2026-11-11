// Page d'administration des statistiques d'usage de Fan Fields 3
'use strict';

(function () {
  const TOKEN_KEY = 'fanfields-stats-admin-token';
  const REGION_LABELS = {
    other: 'Other / unknown',
    north_america: 'North America',
    south_america: 'South America',
    west_europe: 'West Europe',
    middle_east_africa: 'Middle East & Africa',
    east_europe: 'East Europe',
    china: 'China',
    asia: 'Asia'
  };
  const $ = function (id) { return document.getElementById(id); };

  let token = null;

  // localStorage (pas sessionStorage) : la session doit survivre à la fermeture du navigateur,
  // pour coller à la durée de 30 jours accordée côté serveur (voir SESSION_TTL).
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return token; }
  }
  function setToken(t) {
    token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* stockage indisponible : jeton gardé en mémoire */ }
  }

  function api(route, body) {
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    const t = getToken() || token;
    if (t) opts.headers.Authorization = 'Bearer ' + t;
    opts.body = JSON.stringify(body || {});
    return fetch('api/' + route, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (r.status === 401 && route !== 'login') {
          setToken(null);
          showLogin();
        }
        if (!r.ok) {
          const err = new Error(json.error || ('HTTP ' + r.status));
          err.status = r.status;
          err.body = json;
          throw err;
        }
        return json;
      });
    });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function formatHours(seconds) {
    return (seconds / 3600).toFixed(1) + ' h';
  }
  function formatDay(day) {
    return new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  // ---- Vues ----

  function showLogin() {
    $('mainView').hidden = true;
    $('nav').hidden = true;
    $('loginView').hidden = false;
    if ($('passwordDialog').open) $('passwordDialog').close();
    stopLivePolling();
    const input = $('loginForm').elements.user;
    if (!input.value) input.focus(); else $('loginForm').elements.password.focus();
  }

  // ---- Carte "maintenant" (joueurs actifs sur les 30 dernières minutes) ----

  const LIVE_POLL_MS = 20 * 1000;
  let liveTimer = null;

  function startLivePolling() {
    stopLivePolling();
    loadActive();
    liveTimer = setInterval(loadActive, LIVE_POLL_MS);
  }
  function stopLivePolling() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  function loadActive() {
    return api('active', {}).then(renderActive).catch(function (e) {
      // Rafraîchissement silencieux : une erreur ponctuelle (réseau, 401 déjà géré par api())
      // ne doit pas spammer de toast toutes les 20 secondes.
      if (e.status !== 401) console.error('active poll failed', e);
    });
  }

  function renderActive(res) {
    $('liveTotal').textContent = String(res.total);

    const byRegion = {};
    res.byRegion.forEach(function (r) { byRegion[r.region] = r.count; });
    const geoMax = res.byRegion.reduce(function (m, r) {
      return r.region === 'other' ? m : Math.max(m, r.count);
    }, 0) || 1;

    document.querySelectorAll('#worldMap .region-shape').forEach(function (shape) {
      const count = byRegion[shape.dataset.region] || 0;
      shape.style.fillOpacity = count === 0 ? '0' : String(0.15 + 0.75 * (count / geoMax));
    });
    document.querySelectorAll('#worldMap .region-count').forEach(function (label) {
      label.textContent = String(byRegion[label.dataset.region] || 0);
    });

    renderLiveLegend(res.byRegion);
  }

  function renderLiveLegend(rows) {
    const box = $('liveLegend');
    box.textContent = '';
    rows.forEach(function (r) {
      const row = el('div', 'live-legend-row');
      row.appendChild(el('span', null, REGION_LABELS[r.region] || r.region));
      row.appendChild(el('span', 'live-legend-count', String(r.count)));
      box.appendChild(row);
    });
  }

  function showMain() {
    $('loginView').hidden = true;
    $('mainView').hidden = false;
    $('nav').hidden = false;
    load();
    startLivePolling();
  }

  function dateInputValue(d) { return d.toISOString().slice(0, 10); }

  function applyPreset(days) {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    $('from').value = dateInputValue(from);
    $('to').value = dateInputValue(to);
    load();
  }

  function renderStats(res) {
    const box = $('stats');
    box.textContent = '';
    [
      ['Active agents', String(res.totals.uniqueAgents)],
      ['Pings', String(res.totals.events)],
      ['Active time', formatHours(res.totals.seconds)]
    ].forEach(function (s) {
      const d = el('div', 'stat');
      d.appendChild(el('div', 'label', s[0]));
      d.appendChild(el('div', 'value', s[1]));
      box.appendChild(d);
    });
  }

  // Shared renderer for the "Active time per day" and "Registered players" bar charts: both
  // are a row of day bars scaled to their own max, with a left-hand axis showing 3 ticks
  // (max, max/2, 0) lined up with the .history gridlines (50% steps).
  function renderBarChart(boxId, axisId, byDay, valueOf, formatValue, titleOf) {
    const box = $(boxId);
    const axis = $(axisId);
    box.textContent = '';
    axis.textContent = '';
    if (!byDay.length) { box.appendChild(el('p', 'history-empty', 'No data for this range.')); return; }
    const max = byDay.reduce(function (m, d) { return Math.max(m, valueOf(d)); }, 0) || 1;
    [max, max / 2, 0].forEach(function (v) {
      axis.appendChild(el('div', 'history-axis-tick', formatValue(v)));
    });
    byDay.forEach(function (d) {
      const bar = el('div', 'history-bar');
      bar.style.height = Math.max(2, (valueOf(d) / max) * 100) + '%';
      bar.title = titleOf(d);
      box.appendChild(bar);
    });
  }

  function renderHistory(byDay) {
    renderBarChart('history', 'historyAxis', byDay,
      function (d) { return d.seconds; },
      formatHours,
      function (d) { return formatDay(d.date) + ' : ' + formatHours(d.seconds) + ', ' + d.uniqueAgents + ' agent(s)'; });
    renderHistoryLine(byDay);
  }

  // Overlays the "active agents per day" line on the history bar chart, with its own
  // right-hand axis. The connecting line is an SVG polyline stretched to fill its box
  // (non-uniform scaling distorts its angle a little, which is an acceptable tradeoff for
  // a small trend line); the dots are plain positioned divs so they stay round.
  function renderHistoryLine(byDay) {
    const axis = $('historyAxisRight');
    const layer = $('historyLineLayer');
    axis.textContent = '';
    layer.textContent = '';
    if (!byDay.length) return;
    const max = byDay.reduce(function (m, d) { return Math.max(m, d.uniqueAgents); }, 0) || 1;
    [max, max / 2, 0].forEach(function (v) {
      axis.appendChild(el('div', 'history-axis-tick', String(Math.round(v))));
    });

    const n = byDay.length;
    const points = byDay.map(function (d, i) {
      return { x: n === 1 ? 50 : (i / (n - 1)) * 100, y: 100 - (d.uniqueAgents / max) * 100, d: d };
    });

    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'history-line-svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const polyline = document.createElementNS(svgNs, 'polyline');
    polyline.setAttribute('class', 'history-line-path');
    polyline.setAttribute('points', points.map(function (p) { return p.x + ',' + p.y; }).join(' '));
    svg.appendChild(polyline);
    layer.appendChild(svg);

    points.forEach(function (p) {
      const dot = el('div', 'history-line-dot');
      dot.style.left = p.x + '%';
      dot.style.bottom = (100 - p.y) + '%';
      dot.title = formatDay(p.d.date) + ' : ' + p.d.uniqueAgents + ' agent(s)';
      layer.appendChild(dot);
    });
  }

  function renderRegistered(byDay) {
    renderBarChart('registered', 'registeredAxis', byDay,
      function (d) { return d.registeredTotal; },
      function (v) { return String(Math.round(v)); },
      function (d) { return formatDay(d.date) + ' : ' + d.registeredTotal + ' player(s)'; });
  }

  function renderBreakdown(containerId, rows, labelFor, cls) {
    const box = $(containerId);
    box.textContent = '';
    const max = rows.reduce(function (m, r) { return Math.max(m, r.seconds); }, 0) || 1;
    const any = rows.some(function (r) { return r.seconds > 0; });
    if (!any) { box.appendChild(el('p', 'muted', 'No data for this range.')); return; }
    rows.forEach(function (r) {
      if (r.seconds === 0 && r.uniqueAgents === 0) return;
      const row = el('div', 'breakdown-row' + (cls ? ' ' + cls(r) : ''));
      row.appendChild(el('div', null, labelFor(r)));
      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = Math.max(2, (r.seconds / max) * 100) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'muted', formatHours(r.seconds) + ' · ' + r.uniqueAgents + ' agent(s)'));
      box.appendChild(row);
    });
  }

  function load() {
    const body = {
      from: $('from').value,
      to: $('to').value,
      faction: $('faction').value,
      region: $('region').value
    };
    loadAgents(body);
    return api('stats', body).then(function (res) {
      $('whoami').textContent = res.admin.user;
      renderStats(res);
      renderHistory(res.byDay);
      renderRegistered(res.byDay);
      renderBreakdown('byFaction', res.byFaction, function (r) { return r.faction === 'ENL' ? 'Enlightened' : 'Resistance'; },
        function (r) { return r.faction === 'ENL' ? 'enl' : 'res'; });
      renderBreakdown('byRegion', res.byRegion, function (r) { return REGION_LABELS[r.region] || r.region; });
    }).catch(function (e) {
      if (e.status !== 401) toast('Could not load stats: ' + e.message);
    });
  }

  // ---- Carte "Agents" (une ligne par agent, tri et filtres côté page) ----
  // Le serveur renvoie tous les agents de la plage (route agents) ; le top N, le tri, les puces
  // de filtre et la version sont appliqués ici, sans recharger.

  // Options suivies en temps (le plugin les envoie dans `flags` à chaque ping) puis
  // fonctionnalités comptées (`used`). L'icône sert à la colonne Features et aux puces.
  const FLAG_INFO = {
    taskList: { icon: '📋', label: 'Task List open' },
    spendKeys: { icon: '🔑', label: 'Spend keys on throw' },
    sync: { icon: '☁️', label: 'Simple Cloud Sync installed' },
    blockers: { icon: '💥', label: 'Blockers managed' },
    bookmarksOnly: { icon: '🔖', label: 'Bookmarks only' }
  };
  const USED_INFO = {
    taskList: { icon: '📋', label: 'Task List opened' },
    taskRefresh: { icon: '🔄', label: 'Task List refresh' },
    reroute: { icon: '🧭', label: 'Reroute' },
    keysVideo: { icon: '🎥', label: 'Keys video import' },
    ops: { icon: '🗂️', label: 'Manage ops opened' },
    opSave: { icon: '💾', label: 'Op saved' },
    opLoad: { icon: '📂', label: 'Op loaded' },
    printRoute: { icon: '🖨️', label: 'Print route' },
    printPlan: { icon: '📄', label: 'Step by step plan' },
    portalRoute: { icon: '🗺️', label: 'Portal Route' },
    walkSim: { icon: '🚶', label: 'Live simulation' },
    exclude: { icon: '🚫', label: 'Exclude portal' },
    anchor: { icon: '⚓', label: 'Pick anchor' },
    stats: { icon: '📊', label: 'Stats opened' },
    activityRefresh: { icon: '📈', label: 'My activity refresh' }
  };
  const PLAN_LABELS = { '0': 'No plan', '1-10': '1–10', '11-25': '11–25', '26-50': '26–50', '50+': '50+' };
  const PLAN_SIZE_ORDER = Object.keys(PLAN_LABELS);

  // Puces de filtre : chacune garde les agents pour qui test(a) est vrai.
  const CHIPS = [
    { id: 'desktop', label: '🖥️ Desktop', test: function (a) { return a.platform.desktop > 0; } },
    { id: 'mobile', label: '📱 Mobile', test: function (a) { return a.platform.mobile > 0; } },
    { id: 'fan', label: 'Fan', test: function (a) { return a.mode.fan > 0; } },
    { id: 'herringbone', label: 'Herringbone', test: function (a) { return a.mode.herringbone > 0; } }
  ].concat(Object.keys(FLAG_INFO).map(function (k) {
    return { id: 'flag:' + k, label: FLAG_INFO[k].icon + ' ' + FLAG_INFO[k].label, test: function (a) { return a.flags[k] > 0; } };
  })).concat(Object.keys(USED_INFO).filter(function (k) { return k !== 'taskList'; }).map(function (k) {
    return { id: 'used:' + k, label: USED_INFO[k].icon + ' ' + USED_INFO[k].label, test: function (a) { return a.used[k] > 0; } };
  }));

  function share(part, total) { return total > 0 ? part / total : 0; }
  function totalUses(a) { return Object.keys(a.used).reduce(function (s, k) { return s + a.used[k]; }, 0); }
  function dominantPlan(a) {
    let best = null;
    Object.keys(a.plan).forEach(function (k) { if (a.plan[k] > 0 && (best === null || a.plan[k] > a.plan[best])) best = k; });
    return best;
  }
  function compareVersions(x, y) {
    const px = (x || '0.0.0').split('.').map(Number), py = (y || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) if (px[i] !== py[i]) return px[i] - py[i];
    return 0;
  }

  // Critères de tri : les colonnes du tableau (clic sur l'en-tête) et chaque compteur.
  const SORTS = [
    { id: 'seconds', label: 'Active time', value: function (a) { return a.seconds; } },
    { id: 'daysActive', label: 'Days active', value: function (a) { return a.daysActive; } },
    { id: 'mobileShare', label: 'Mobile share', value: function (a) { return share(a.platform.mobile, a.detailedSeconds); } },
    { id: 'herringboneShare', label: 'Herringbone share', value: function (a) { return share(a.mode.herringbone, a.detailedSeconds); } },
    { id: 'plan', label: 'Plan size', value: function (a) { const p = dominantPlan(a); return p === null ? -1 : PLAN_SIZE_ORDER.indexOf(p); } },
    { id: 'version', label: 'Version', compare: function (a, b) { return compareVersions(a.version, b.version); } },
    { id: 'uses', label: 'Feature uses (total)', value: totalUses },
    { id: 'lastTs', label: 'Last seen', value: function (a) { return a.lastTs; } }
  ].concat(Object.keys(USED_INFO).map(function (k) {
    return { id: 'used:' + k, label: USED_INFO[k].icon + ' ' + USED_INFO[k].label, value: function (a) { return a.used[k]; } };
  }));

  // Colonnes du tableau ; `sort` renvoie au critère de tri de même id quand la colonne est triable.
  const COLUMNS = [
    { label: '#' },
    { label: 'Agent' },
    { label: 'Faction' },
    { label: 'Region' },
    { label: 'Time', sort: 'seconds' },
    { label: 'Days', sort: 'daysActive' },
    { label: 'Desktop · Mobile', sort: 'mobileShare' },
    { label: 'Fan · Herringbone', sort: 'herringboneShare' },
    { label: 'Plan', sort: 'plan' },
    { label: 'Version', sort: 'version' },
    { label: 'Features', sort: 'uses' },
    { label: 'Last seen', sort: 'lastTs' }
  ];

  let agentsData = [];
  let agentsSort = { id: 'seconds', desc: true };
  const activeChips = new Set();
  let expandedAgent = null;

  function shortHash(h) { return h.slice(0, 4) + '·' + h.slice(4, 8); }

  // Pastille 5×5 symétrique tirée du hash (comme les avatars GitHub) : reconnaissable d'un coup
  // d'œil d'une visite à l'autre, sans rien révéler de plus que le hash lui-même.
  function identicon(hash) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 5 5');
    svg.setAttribute('class', 'identicon');
    const hue = parseInt(hash.slice(0, 3), 16) % 360;
    const color = 'hsl(' + hue + ', 60%, 50%)';
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) {
        const bit = parseInt(hash[3 + y * 3 + x], 16) % 2;
        if (!bit) continue;
        [x, 4 - x].forEach(function (cx, i) {
          if (i === 1 && cx === x) return;
          const r = document.createElementNS(svgNs, 'rect');
          r.setAttribute('x', cx);
          r.setAttribute('y', y);
          r.setAttribute('width', 1);
          r.setAttribute('height', 1);
          r.setAttribute('fill', color);
          svg.appendChild(r);
        });
      }
    }
    return svg;
  }

  function splitBar(parts, total) {
    const wrap = el('div', 'split');
    if (!total) { wrap.appendChild(el('span', 'muted', '—')); return wrap; }
    const track = el('div', 'split-track');
    parts.forEach(function (p) {
      const seg = el('div', 'split-seg ' + p.cls);
      seg.style.width = (share(p.value, total) * 100) + '%';
      track.appendChild(seg);
    });
    track.title = parts.map(function (p) { return p.label + ' ' + Math.round(share(p.value, total) * 100) + '% (' + formatHours(p.value) + ')'; }).join(' · ');
    wrap.appendChild(track);
    const last = parts[parts.length - 1];
    wrap.appendChild(el('span', 'split-pct', last.short + ' ' + Math.round(share(last.value, total) * 100) + '%'));
    return wrap;
  }

  function featureIcons(a) {
    const box = el('div', 'features');
    Object.keys(USED_INFO).forEach(function (k) {
      const n = a.used[k];
      const i = el('span', 'feature' + (n > 0 ? ' on' : ''), USED_INFO[k].icon);
      i.title = USED_INFO[k].label + ' : ' + n;
      box.appendChild(i);
    });
    box.appendChild(el('span', 'features-sep'));
    Object.keys(FLAG_INFO).filter(function (k) { return k !== 'taskList'; }).forEach(function (k) {
      const s = a.flags[k];
      const i = el('span', 'feature' + (s > 0 ? ' on' : ''), FLAG_INFO[k].icon);
      i.title = FLAG_INFO[k].label + ' : ' + Math.round(share(s, a.detailedSeconds) * 100) + '% of the time';
      box.appendChild(i);
    });
    return box;
  }

  function formatAgo(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return mins + ' min ago';
    if (mins < 48 * 60) return Math.round(mins / 60) + ' h ago';
    return Math.round(mins / 1440) + ' d ago';
  }

  function filteredAgents() {
    const version = $('agentsVersion').value;
    const chips = CHIPS.filter(function (c) { return activeChips.has(c.id); });
    return agentsData.filter(function (a) {
      if (version !== 'all' && a.version !== version) return false;
      return chips.every(function (c) { return c.test(a); });
    });
  }

  function sortedAgents(list) {
    const s = SORTS.find(function (x) { return x.id === agentsSort.id; }) || SORTS[0];
    const cmp = s.compare || function (a, b) { return s.value(a) - s.value(b); };
    return list.slice().sort(function (a, b) {
      const c = cmp(a, b);
      return (agentsSort.desc ? -c : c) || (b.seconds - a.seconds);
    });
  }

  function visibleAgents() {
    const top = Number($('agentsTop').value);
    const list = sortedAgents(filteredAgents());
    return top > 0 ? list.slice(0, top) : list;
  }

  function renderChips() {
    const box = $('agentsChips');
    box.textContent = '';
    CHIPS.forEach(function (c) {
      const b = el('button', 'chip' + (activeChips.has(c.id) ? ' active' : ''), c.label);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (activeChips.has(c.id)) activeChips.delete(c.id); else activeChips.add(c.id);
        renderAgents();
      });
      box.appendChild(b);
    });
    if (activeChips.size) {
      const clear = el('button', 'chip chip-clear', 'Clear filters');
      clear.type = 'button';
      clear.addEventListener('click', function () { activeChips.clear(); renderAgents(); });
      box.appendChild(clear);
    }
  }

  // Part des agents filtrés (avant le top N) qui utilisent chaque élément : sert à voir
  // l'adoption d'une fonctionnalité dans la population sélectionnée.
  function renderAdoption(list) {
    const box = $('agentsAdoption');
    box.textContent = '';
    box.appendChild(el('span', 'adoption-title', list.length + ' agent(s) match'));
    if (!list.length) return;
    CHIPS.forEach(function (c) {
      const n = list.filter(c.test).length;
      if (!n) return;
      const item = el('span', 'adoption-item', c.label + ' ' + Math.round(n / list.length * 100) + '%');
      item.title = n + ' / ' + list.length + ' agent(s)';
      box.appendChild(item);
    });
  }

  function renderHead() {
    const row = $('agentsHeadRow');
    row.textContent = '';
    COLUMNS.forEach(function (c) {
      const th = el('th', c.sort ? 'sortable' : null, c.label);
      if (c.sort) {
        if (agentsSort.id === c.sort) {
          th.classList.add('sorted');
          th.appendChild(el('span', 'sort-arrow', agentsSort.desc ? ' ▼' : ' ▲'));
        }
        th.addEventListener('click', function () { setSort(c.sort, agentsSort.id === c.sort ? !agentsSort.desc : true); });
      }
      row.appendChild(th);
    });
  }

  function setSort(id, desc) {
    agentsSort = { id: id, desc: desc };
    $('agentsSort').value = id;
    renderAgents();
  }

  function agentRow(a, rank) {
    const tr = el('tr', 'agent-row' + (expandedAgent === a.agent ? ' expanded' : ''));
    const cells = [];
    cells.push(el('td', 'num', String(rank)));
    const who = el('td', 'who');
    who.appendChild(identicon(a.agent));
    who.appendChild(el('code', null, shortHash(a.agent)));
    cells.push(who);
    cells.push(el('td', 'fac ' + (a.faction === 'ENL' ? 'enl' : 'res'), a.faction));
    cells.push(el('td', null, REGION_LABELS[a.region] || a.region));
    cells.push(el('td', 'num', formatHours(a.seconds)));
    cells.push(el('td', 'num', String(a.daysActive)));
    const plat = el('td');
    plat.appendChild(splitBar([
      { label: 'Desktop', value: a.platform.desktop, cls: 'seg-desktop' },
      { label: 'Mobile', short: '📱', value: a.platform.mobile, cls: 'seg-mobile' }
    ], a.platform.desktop + a.platform.mobile));
    cells.push(plat);
    const mode = el('td');
    mode.appendChild(splitBar([
      { label: 'Fan', value: a.mode.fan, cls: 'seg-fan' },
      { label: 'Herringbone', short: 'HB', value: a.mode.herringbone, cls: 'seg-hb' }
    ], a.mode.fan + a.mode.herringbone));
    cells.push(mode);
    const plan = dominantPlan(a);
    cells.push(el('td', null, plan === null ? '—' : PLAN_LABELS[plan]));
    cells.push(el('td', null, a.version || '—'));
    const feat = el('td');
    feat.appendChild(featureIcons(a));
    cells.push(feat);
    const seen = el('td', 'muted', formatAgo(a.lastTs));
    seen.title = new Date(a.lastTs).toLocaleString();
    cells.push(seen);
    cells.forEach(function (c) { tr.appendChild(c); });
    tr.addEventListener('click', function () {
      expandedAgent = expandedAgent === a.agent ? null : a.agent;
      renderAgents();
    });
    return tr;
  }

  function detailRow(a) {
    const tr = el('tr', 'agent-detail');
    const td = el('td');
    td.colSpan = COLUMNS.length;
    const box = el('div', 'detail');

    const head = el('div', 'detail-head');
    const hash = el('code', 'detail-hash', a.agent);
    head.appendChild(hash);
    const copy = el('button', 'ghost small', 'Copy hash');
    copy.type = 'button';
    copy.addEventListener('click', function (ev) {
      ev.stopPropagation();
      navigator.clipboard.writeText(a.agent).then(function () { toast('Hash copied'); }, function () { toast('Could not copy'); });
    });
    head.appendChild(copy);
    head.appendChild(el('span', 'muted', 'First seen ' + new Date(a.firstTs).toLocaleDateString() +
      ' · ' + a.pings + ' pings · ' + formatHours(a.seconds) + ' over ' + a.daysActive + ' day(s)'));
    box.appendChild(head);

    // Temps par jour, empilé desktop / mobile / sans détail (pings v1).
    const chart = el('div', 'detail-chart');
    const max = a.byDay.reduce(function (m, d) { return Math.max(m, d.seconds); }, 0) || 1;
    a.byDay.forEach(function (d) {
      const col = el('div', 'detail-col');
      col.title = formatDay(d.date) + ' : ' + formatHours(d.seconds) + ' (desktop ' + formatHours(d.desktop) + ', mobile ' + formatHours(d.mobile) + ')';
      const unknown = Math.max(0, d.seconds - d.desktop - d.mobile);
      [['seg-mobile', d.mobile], ['seg-desktop', d.desktop], ['seg-unknown', unknown]].forEach(function (p) {
        if (!p[1]) return;
        const seg = el('div', 'detail-seg ' + p[0]);
        seg.style.height = (p[1] / max * 100) + '%';
        col.appendChild(seg);
      });
      chart.appendChild(col);
    });
    box.appendChild(chart);
    const legend = el('div', 'history-legend');
    [['seg-desktop', 'Desktop'], ['seg-mobile', 'Mobile'], ['seg-unknown', 'No details (before 7.1.0)']].forEach(function (l) {
      const item = el('span', 'history-legend-item');
      item.appendChild(el('span', 'history-legend-swatch ' + l[0]));
      item.appendChild(document.createTextNode(l[1]));
      legend.appendChild(item);
    });
    box.appendChild(legend);

    const grid = el('div', 'detail-grid');
    function block(title, rows) {
      const b = el('div', 'detail-block');
      b.appendChild(el('h3', null, title));
      rows.forEach(function (r) {
        const line = el('div', 'detail-line' + (r[2] ? '' : ' off'));
        line.appendChild(el('span', null, r[0]));
        line.appendChild(el('span', 'num', r[1]));
        b.appendChild(line);
      });
      grid.appendChild(b);
    }
    const pct = function (s) { return Math.round(share(s, a.detailedSeconds) * 100) + '%'; };
    block('Plan size (share of time)', PLAN_SIZE_ORDER.map(function (k) { return [PLAN_LABELS[k], pct(a.plan[k]), a.plan[k] > 0]; }));
    block('Options (share of time)', Object.keys(FLAG_INFO).map(function (k) {
      return [FLAG_INFO[k].icon + ' ' + FLAG_INFO[k].label, pct(a.flags[k]), a.flags[k] > 0];
    }));
    block('Features (times used)', Object.keys(USED_INFO).map(function (k) {
      return [USED_INFO[k].icon + ' ' + USED_INFO[k].label, String(a.used[k]), a.used[k] > 0];
    }));
    box.appendChild(grid);

    td.appendChild(box);
    tr.appendChild(td);
    return tr;
  }

  function renderAgents() {
    renderChips();
    renderHead();
    const filtered = filteredAgents();
    renderAdoption(filtered);
    const body = $('agentsBody');
    body.textContent = '';
    const list = visibleAgents();
    if (!list.length) {
      const tr = el('tr');
      const td = el('td', 'muted center', agentsData.length ? 'No agent matches these filters.' : 'No data for this range.');
      td.colSpan = COLUMNS.length;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    list.forEach(function (a, i) {
      body.appendChild(agentRow(a, i + 1));
      if (expandedAgent === a.agent) body.appendChild(detailRow(a));
    });
  }

  function fillVersionOptions() {
    const select = $('agentsVersion');
    const current = select.value;
    const versions = Array.from(new Set(agentsData.map(function (a) { return a.version; }).filter(Boolean)))
      .sort(compareVersions).reverse();
    while (select.options.length > 1) select.remove(1);
    versions.forEach(function (v) {
      const opt = el('option', null, v);
      opt.value = v;
      select.appendChild(opt);
    });
    select.value = versions.indexOf(current) !== -1 ? current : 'all';
  }

  function loadAgents(body) {
    return api('agents', body).then(function (res) {
      agentsData = res.agents;
      fillVersionOptions();
      renderAgents();
    }).catch(function (e) {
      if (e.status !== 401) toast('Could not load agents: ' + e.message);
    });
  }

  function csvCell(v) {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Exporte exactement les lignes affichées (filtres, tri et top N appliqués).
  function exportAgentsCsv() {
    const list = visibleAgents();
    const flagKeys = Object.keys(FLAG_INFO), usedKeys = Object.keys(USED_INFO);
    const header = ['agent', 'faction', 'region', 'version', 'seconds', 'detailed_seconds', 'days_active', 'pings',
      'first_seen', 'last_seen', 'desktop_seconds', 'mobile_seconds', 'fan_seconds', 'herringbone_seconds']
      .concat(PLAN_SIZE_ORDER.map(function (k) { return 'plan_' + k + '_seconds'; }))
      .concat(flagKeys.map(function (k) { return 'option_' + k + '_seconds'; }))
      .concat(usedKeys.map(function (k) { return 'used_' + k; }));
    const lines = [header.join(',')].concat(list.map(function (a) {
      return [a.agent, a.faction, a.region, a.version, a.seconds, a.detailedSeconds, a.daysActive, a.pings,
        new Date(a.firstTs).toISOString(), new Date(a.lastTs).toISOString(),
        a.platform.desktop, a.platform.mobile, a.mode.fan, a.mode.herringbone]
        .concat(PLAN_SIZE_ORDER.map(function (k) { return a.plan[k]; }))
        .concat(flagKeys.map(function (k) { return a.flags[k]; }))
        .concat(usedKeys.map(function (k) { return a.used[k]; }))
        .map(csvCell).join(',');
    }));
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fanfields-agents-' + $('from').value + '_' + $('to').value + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function initAgents() {
    SORTS.forEach(function (s) {
      const opt = el('option', null, s.label);
      opt.value = s.id;
      $('agentsSort').appendChild(opt);
    });
    $('agentsSort').value = agentsSort.id;
    $('agentsSort').addEventListener('change', function () { setSort(this.value, true); });
    $('agentsTop').addEventListener('change', renderAgents);
    $('agentsVersion').addEventListener('change', renderAgents);
    $('agentsCsv').addEventListener('click', exportAgentsCsv);
  }

  // ---- Mot de passe admin ----

  function openPassword() {
    $('passwordForm').reset();
    $('passwordError').hidden = true;
    $('passwordDialog').showModal();
  }

  function submitPassword(ev) {
    ev.preventDefault();
    const f = ev.target.elements;
    const err = $('passwordError');
    const fail = function (msg) { err.textContent = msg; err.hidden = false; };
    if (f.password.value !== f.confirm.value) return fail('The new passwords do not match.');
    api('password', { current: f.current.value, password: f.password.value }).then(function () {
      $('passwordDialog').close();
      toast('Admin password changed');
    }).catch(function (e) {
      if (e.status === 403) fail('Current password is wrong.');
      else if (e.status === 429) fail('Too many attempts, try again later.');
      else if (e.body && e.body.error === 'weak password') fail('The new password must be at least ' + e.body.min + ' characters long.');
      else fail('Error: ' + e.message);
    });
  }

  // ---- Connexion ----

  function submitLogin(ev) {
    ev.preventDefault();
    const f = ev.target.elements;
    const err = $('loginError');
    err.hidden = true;
    api('login', { user: f.user.value.trim(), password: f.password.value }).then(function (res) {
      setToken(res.token);
      f.password.value = '';
      showMain();
    }).catch(function (e) {
      err.textContent = e.status === 429 ? 'Too many attempts, try again later.'
        : e.status === 401 ? 'Wrong user or password.' : 'Error: ' + e.message;
      err.hidden = false;
    });
  }

  function logout() {
    api('logout', {}).catch(function () { /* session déjà expirée */ }).then(function () {
      setToken(null);
      showLogin();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    Object.keys(REGION_LABELS).forEach(function (region) {
      const opt = el('option', null, REGION_LABELS[region]);
      opt.value = region;
      $('region').appendChild(opt);
    });

    initAgents();
    applyPreset(30);

    $('loginForm').addEventListener('submit', submitLogin);
    $('passwordForm').addEventListener('submit', submitPassword);
    $('btnLogout').addEventListener('click', logout);
    $('btnPassword').addEventListener('click', openPassword);
    $('btnApply').addEventListener('click', load);
    document.querySelectorAll('#presets button').forEach(function (b) {
      b.addEventListener('click', function () { applyPreset(Number(b.dataset.days)); });
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { b.closest('dialog').close(); });
    });

    if (getToken()) showMain(); else showLogin();
  });
})();
