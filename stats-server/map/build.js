'use strict';
// One-off build script (see README.md in this folder) : turns the raw country-path world map
// SVG into the flat list of <path data-region="..."> elements embedded directly in
// admin/index.html, plus the (x, y) label position for each region's live count. Not run at
// runtime — the admin page ships the already-generated markup, this script is only for
// regenerating it after the source map or the region buckets change.
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

// Réutilise la même table pays -> région que le serveur (geoip/build.js), pour ne jamais avoir
// deux définitions de ce découpage à maintenir en parallèle. build.js s'exécute lui-même au
// require (voir sa dernière ligne), donc on en extrait juste l'objet plutôt que de l'importer.
const geoipBuildSrc = fs.readFileSync(path.join(__dirname, '../geoip/build.js'), 'utf8');
const m = geoipBuildSrc.match(/const COUNTRY_REGION = \{([\s\S]*?)\n\};/);
if (!m) throw new Error('COUNTRY_REGION introuvable dans geoip/build.js');
const COUNTRY_REGION = new Function('return {' + m[1] + '}')();

// Le Somaliland n'a pas de code ISO 3166-1 (territoire non reconnu) : rattaché à Middle East &
// Africa comme le reste de la Corne de l'Afrique, cohérent avec le classement des pays voisins.
const SPECIAL = { _somaliland: 'middle_east_africa' };
function regionFor(id) {
  if (SPECIAL[id]) return SPECIAL[id];
  return COUNTRY_REGION[id.toUpperCase()] || 'other';
}

// Découpe un "d" en sous-chemins (un par commande M). Seules M/m L/l H/h V/v Z/z sont utilisées
// dans le fichier source (polygones, pas de courbes) : pas besoin d'un vrai moteur de chemin.
function parseSubpaths(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  const subpaths = [];
  let current = null;
  let cmd = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; }
    const num = function () { return parseFloat(tokens[i++]); };
    switch (cmd) {
      case 'M': cx = num(); cy = num(); sx = cx; sy = cy; current = [[cx, cy]]; subpaths.push(current); cmd = 'L'; break;
      case 'm': cx += num(); cy += num(); sx = cx; sy = cy; current = [[cx, cy]]; subpaths.push(current); cmd = 'l'; break;
      case 'L': cx = num(); cy = num(); current.push([cx, cy]); break;
      case 'l': cx += num(); cy += num(); current.push([cx, cy]); break;
      case 'H': cx = num(); current.push([cx, cy]); break;
      case 'h': cx += num(); current.push([cx, cy]); break;
      case 'V': cy = num(); current.push([cx, cy]); break;
      case 'v': cy += num(); current.push([cx, cy]); break;
      case 'Z': case 'z': cx = sx; cy = sy; break;
      default: i++; break;
    }
  }
  return subpaths;
}

// Aire signée (formule du lacet) + centroïde du polygone. Essentiel pour les pays avec des
// exclaves lointaines (ex. la France inclut ses territoires d'outre-mer dans ce fichier source) :
// pondérer par un centre de bounding-box les aurait fait peser autant que leur métropole et
// aurait tiré le centroïde de la région vers l'océan. Une exclave minuscule a une aire minuscule,
// donc ne pèse presque rien ici, contrairement à son effet sur une bounding-box.
function polygon(points) {
  let a = 0, cx = 0, cy = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[i], p1 = points[(i + 1) % n];
    const cross = p0[0] * p1[1] - p1[0] * p0[1];
    a += cross;
    cx += (p0[0] + p1[0]) * cross;
    cy += (p0[1] + p1[1]) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) {
    const mx = points.reduce(function (s, p) { return s + p[0]; }, 0) / n;
    const my = points.reduce(function (s, p) { return s + p[1]; }, 0) / n;
    return { area: 0, cx: mx, cy: my };
  }
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

function collectPaths(node, out) {
  if (node.tagName === 'path') { out.push(node); return; }
  Array.prototype.slice.call(node.childNodes).forEach(function (k) { if (k.nodeType === 1) collectPaths(k, out); });
}

const srcFile = process.argv[2] || 'world-map.svg';
const svgText = fs.readFileSync(srcFile, 'utf8');
const doc = new DOMParser().parseFromString(svgText, 'text/xml');
const root = doc.documentElement;
const rootG = root.getElementsByTagName('g')[0];
const children = Array.prototype.slice.call(rootG.childNodes).filter(function (n) { return n.nodeType === 1; });

const byId = {};
const regionAgg = {};

children.forEach(function (node) {
  const id = node.getAttribute('id');
  if (!id) return;
  const pathEls = [];
  collectPaths(node, pathEls);
  if (!pathEls.length) return;
  const region = regionFor(id);
  const ds = [];
  let countryArea = 0, countrySx = 0, countrySy = 0;
  pathEls.forEach(function (p) {
    const d = p.getAttribute('d');
    ds.push(d);
    parseSubpaths(d).forEach(function (pts) {
      if (pts.length < 3) return;
      const poly = polygon(pts);
      countryArea += poly.area;
      countrySx += poly.cx * poly.area;
      countrySy += poly.cy * poly.area;
    });
  });
  if (countryArea <= 0) return;
  const cx = countrySx / countryArea;
  const cy = countrySy / countryArea;
  byId[id] = { region: region, ds: ds };
  if (!regionAgg[region]) regionAgg[region] = { sx: 0, sy: 0, sw: 0 };
  regionAgg[region].sx += cx * countryArea;
  regionAgg[region].sy += cy * countryArea;
  regionAgg[region].sw += countryArea;
});

const centroids = {};
Object.keys(regionAgg).forEach(function (r) {
  const a = regionAgg[r];
  centroids[r] = { x: Math.round(a.sx / a.sw * 100) / 100, y: Math.round(a.sy / a.sw * 100) / 100 };
});

let pathsOut = '';
Object.keys(byId).forEach(function (id) {
  const info = byId[id];
  pathsOut += '<path class="region-shape" data-region="' + info.region + '" d="' + info.ds.join(' ') + '"/>\n';
});

fs.writeFileSync('world-map.paths.txt', pathsOut);
fs.writeFileSync('centroids.json', JSON.stringify(centroids, null, 2));
console.log('Territoires traités :', Object.keys(byId).length);
console.log('viewBox source :', root.getAttribute('viewBox'));
console.log('Centroïdes par région :', JSON.stringify(centroids, null, 2));
console.log('-> world-map.paths.txt et centroids.json écrits. Voir README.md pour la suite.');
