# World map (live region view)

The `<svg id="worldMap">` block in `admin/index.html` (one `<path class="region-shape"
data-region="...">` per country/territory, plus one `<text class="region-count">` label per
region) is generated offline by `build.js` and pasted into the page — the admin dashboard never
fetches or parses anything at runtime beyond that markup, same approach as `geoip/`.

## Source map

[`simple-world-map`](https://github.com/flekschas/simple-world-map) by Al MacDonald, edited by
Fritz Lekschas — CC BY-SA 3.0. 180 country/territory paths as plain polygons (no curves), each
tagged with its ISO 3166-1 alpha-2 code (plus one non-ISO `_somaliland`).

## Regenerating

```sh
npm install --no-save @xmldom/xmldom   # only needed to run this script, not shipped
curl -LO https://raw.githubusercontent.com/flekschas/simple-world-map/master/world-map.svg
node build.js world-map.svg
```

`build.js`:
1. Reuses the same `COUNTRY_REGION` table as `../geoip/build.js` (extracted from its source so
   there's only ever one place that defines the 8 region buckets), to color every country.
2. Computes each region's label position as the area-weighted centroid of its countries, using
   the shoelace formula per polygon rather than a bounding-box center — important here because
   a few countries in this source map (e.g. France) include far-flung overseas territories in
   their path, which would otherwise drag a bounding-box center way off into the ocean.
3. Writes `world-map.paths.txt` (the `<path>` elements to paste into the SVG) and
   `centroids.json` (the `x, y` to use on each region's `<text class="region-count">`).

Paste `world-map.paths.txt`'s contents in place of the existing `<path class="region-shape" ...>`
elements in `admin/index.html`, and update the 7 `<text class="region-count">` label coordinates
from `centroids.json`. Keep the source SVG's `viewBox` as-is on `#worldMap` and on the background
`<rect>`.

Re-run only when the region buckets change (`COUNTRY_REGION` in `geoip/build.js`) or a better
source map is found — not security-critical, no automation for it.
