# Views

Views: **log**, **table**, **chart**, **graph**, **map**, **document**, **gauge** and **custom**. Any panel can also carry a smart output (see `smart`).

A view's own settings go in an object named after it, e.g. `{ view: "gauge", gauge: { value: "cpu", style: "dial", max: 100 } }`. They can change at any time with `panel_update`; sending the object replaces it whole. When `panel_update` switches to another view, the previous view's object is dropped.

## log

Shows each item as one line, in a monospace font without wrapping (scroll sideways for long lines).

- Accepts `format: "lines"` and `update: "append"`.
- Renders terminal colors (ANSI escape codes), so colored output from test runners and CLIs looks right.
- Has a search box that filters the panel to matching lines (case-insensitive) and shows how many match.
- Follows the newest line by default. When the user scrolls up, following pauses; a "Jump to latest" button resumes it. Set `follow: false` to turn it off.
- Use `retention: { last: <lines> }` for logs that never end.

## table

```
panel_create({ id: "jobs", title: "Jobs", preset: "table", table: { columns: ["name", "status", "ms"] } })
```

- Accepts `format: "ndjson"` or `"csv"`, and `update: "append"`, `"upsert"` or `"patch"`. With upsert and patch, updated rows change in place.
- `table.columns`: the columns to show, in order. Without it, the columns are the CSV header, or the fields in the order they first appear. For CSV without a header, rows are lists and `columns` names their positions.
- Objects and lists inside a cell are shown as JSON.
- The user can sort by clicking a column header (ascending, descending, then arrival order). Numbers, including numeric CSV text, sort by value.
- Append tables follow the newest row by default, except while sorted.

## chart

```
panel_create({ id: "latency", title: "Latency", preset: "timeseries", chart: { x: "time", x_type: "time", y: ["p50", "p99"] } })
```

- Accepts `format: "ndjson"` or `"csv"`, and `update: "append"`, `"upsert"` or `"patch"`.
- Two engines: **uPlot** (the default) for large, fast time series, and **Vega-Lite** for everything else.
- Both take their colors from the theme: `--tapet-series-1` to `--tapet-series-8` for series, in that order, then `--tapet-grid` and `--tapet-axis` (see `css`).

### uPlot

- `chart.y`: the field to plot, or a list of up to 8 fields. Required.
- `chart.x`: the field for the x axis. Without it, each item is placed at the time it arrived.
- `chart.x_type`: `number` (the default) or `time`. Times are ISO 8601 text or milliseconds since 1970.
- `chart.series`: splits one `y` field into a series per value of this field, e.g. `series: "host"`. The chart shows the first 8 values.
- `chart.type`: `line` (the default), `area`, `bar` or `points`. Areas and bars start from zero. Bars draw a single series.
- Items are sorted by x. Values that aren't numbers leave gaps.
- Two or more series get a legend; up to four also get their names at the ends of their lines.
- The user can drag across the chart to zoom in, which stops it from following new data. A double-click zooms back out. Hovering shows each series' value at that point.

### Vega-Lite

```
chart: { engine: "vega-lite", spec: { data: { name: "tapet" }, mark: "bar", encoding: { … } } }
```

- `chart.spec`: a full Vega-Lite spec. Its data named `"tapet"` receives the panel's items, about 30 updates per second. Items that aren't objects arrive as `{ "data": <item> }`.
- Use it for grouped or stacked bars, heatmaps, aggregations, layers, and anything else uPlot doesn't draw.
- A spec without its own `width` and `height` fills the panel.
- The spec's own `config` overrides tapet's theme.
- Data from URLs isn't loaded, because the window doesn't use the network.

## graph

```
panel_create({ id: "calls", title: "Service calls", preset: "graph", graph: { label: "name", color: "team" } })
```

- Accepts `format: "ndjson"` or `"csv"` with a header, and `update: "append"`, `"upsert"` or `"patch"`.
- Items with `source` and `target` fields are edges; the others are nodes, identified by `id`. Nodes that edges mention but no item defines are created from the edges, so a plain edge list is a graph.
- The `graph` preset upserts by `id`, so every item needs an `id`, edges included. For a plain edge list, add `update: "append"`.
- A later item for a node replaces the earlier one.
- `graph.id`, `graph.source`, `graph.target`: other names for those fields, e.g. `{ source: "from", target: "to" }`.
- `graph.label`: the field shown as a node's label. Defaults to its id.
- `graph.color`: colors nodes by this field's value, one series color per value (`--tapet-series-1` to `8`, see `css`). Further values, and nodes without one, are gray.
- `graph.size`: sizes nodes by this field's number, so their areas follow the values.
- `graph.layout`: `force` (the default) runs on the GPU and handles a million nodes. `hierarchical` lays out dependencies and pipelines in layers, top to bottom, for up to 3,000 nodes.
- Labels show for the largest and best-connected nodes that fit without overlapping. Hovering a node shows its fields.
- The user can zoom, pan and drag nodes. Until they do, the view keeps the whole graph in sight.
- The panel shows how many nodes and edges it has.

## map

```
panel_create({ id: "votes", title: "Votes by town", preset: "map", map: { color_by: "votes", tooltip: ["name", "votes"] } })
```

- Accepts `format: "ndjson"`, and `update: "append"`, `"upsert"` or `"patch"`. Each item is a GeoJSON feature: `{ "type": "Feature", "id": …, "geometry": …, "properties": … }`. Points, lines and polygons all work, including their multi forms.
- The `map` preset upserts by `id`, so a later version of a feature replaces it, e.g. a vote count that grows. Many GeoJSON files keep the id in `properties`; jq can lift it: `jq -c '.features[] | .id = .properties.code'`.
- `map.base_map`: the map underneath. `"light"` and `"dark"` are OpenFreeMap's positron and dark styles; unset, it follows the app's light or dark mode. Another style must be an https URL on an allowed host (tiles.openfreemap.org). `false` draws only the features, with no network.
- `map.label_language`: the language of the base map's labels, e.g. `"he"`. Defaults to `"en"`. Places without a name in that language show their local name.
- `map.borders`: `true` shows country and region borders and names on the base map. They're off by default, so the map takes no side where borders are disputed; cities, roads and water are always labeled.
- `map.color_by`: colors features by this property's number along a blue scale, with a legend. Features without a number are gray. On a dark base map (dark mode, or `base_map: "dark"`) the scale runs the other way, so small values fade into the background. `map.colors` replaces the scale with your own CSS colors, smallest value first.
- Features can style themselves with these properties, from the [simplestyle spec](https://github.com/mapbox/simplestyle-spec) plus `sort-key` and `label`. They win over the panel's colors, `color_by` included, and a value that isn't a color or a number falls back to the panel's. For example: `{ "type": "Feature", "id": "haifa", "geometry": …, "properties": { "marker-color": "#e41a1c", "marker-size": "large", "label": "Haifa" } }`.

  | Property         | Applies to              | Value                                                                   |
  | ---------------- | ----------------------- | ----------------------------------------------------------------------- |
  | `marker-color`   | points                  | a color, e.g. `"#e41a1c"` or `"red"`                                    |
  | `marker-size`    | points                  | `"small"`, `"medium"` (the default), `"large"`, or the radius in pixels |
  | `fill`           | polygons                | a color                                                                 |
  | `fill-opacity`   | polygons                | 0 to 1; 0.75 by default                                                 |
  | `stroke`         | lines, polygon outlines | a color                                                                 |
  | `stroke-width`   | lines, polygon outlines | pixels; 2 for lines and 0.75 for outlines by default                    |
  | `stroke-opacity` | lines, polygon outlines | 0 to 1                                                                  |
  | `sort-key`       | all                     | a number: higher draws on top, and keeps its label when labels collide  |
  | `label`          | all                     | text beside a point, inside a polygon or along a line                   |

- Labels sit above the base map's own labels, which give way where they collide. Without a base map, they're drawn in the window's font.
- `map.layers`: your own [MapLibre layers](https://maplibre.org/maplibre-style-spec/layers/) in place of tapet's, for what the properties above don't cover: colors and sizes computed with expressions, heatmaps, extrusions. Each layer has a `type` (`circle`, `fill`, `line`, `symbol`, `heatmap` or `fill-extrusion`) and any of `paint`, `layout`, `filter`, `minzoom` and `maxzoom`. tapet sets `id` and `source`: every layer draws the panel's features. MapLibre's validator checks the layers, so a mistake fails the call with its path, e.g. `map.layers.0.paint.circle-color: color expected, number found`. With `layers`, color in the layer: `color_by` and `colors` don't apply. In symbol layers, `text-font: ["Noto Sans Regular"]` is the base maps' font. Results by town, colored by the winning party and sized by votes, the biggest on top:

  ```
  map: { layers: [{
    type: "circle",
    paint: {
      "circle-color": ["match", ["get", "party"], "A", "#4269d0", "B", "#efb118", "#999999"],
      "circle-radius": ["*", 0.03, ["sqrt", ["get", "votes"]]]
    },
    layout: { "circle-sort-key": ["get", "votes"] }
  }] }
  ```

- `map.legend`: categories and their colors, e.g. `[{ label: "Party A", color: "#4269d0" }]`. Without it, the legend lists the values of the first layer colored by `["match", ["get", field], …]`, with the field as its title and the fallback color as "other"; without that either, it shows the `color_by` scale. A long legend scrolls past 12 rows.
- `map.tooltip`: the properties shown when hovering a feature. Defaults to all of them.
- The view zooms to the data when it first arrives; after that, the user moves it.
- If the base map doesn't load within 15 seconds, you get a notice; `base_map: false` draws the features anyway.

## document

```
panel_create({ id: "report", title: "Report", preset: "document" })
```

Then pipe a whole file: `cat report.md | <pipe>`. Each pipe is one document.

- Accepts `format: "whole"`, and `update: "replace"` (shows the latest document) or `"append"` (stacks documents in order).
- `document.content`: what the documents are.
  - `markdown` (the default): code blocks are highlighted, `$…$` and `$$…$$` are math (KaTeX), and ` ```mermaid ` blocks are drawn as diagrams.
  - `html`: shown sanitized. Scripts never run; for anything interactive, use the custom view. The document's `<style>` elements apply only inside it. There's no `<body>` element to style, so style a wrapper element instead.
  - `text`: shown as is, in a monospace font.
  - `image`: PNG, JPEG, GIF, WebP or SVG bytes, e.g. `cat chart.png | <pipe>`.
- Documents are UTF-8.
- The window loads images only from tapet's allowed hosts (see `custom`); otherwise use `data:` URLs in markdown and HTML.

## gauge

```
panel_create({ id: "cpu", title: "CPU", preset: "gauge", gauge: { style: "dial", max: 100, unit: "%" } })
```

Shows the latest value: `while true; do <read cpu> ; sleep 1; done | <pipe>`.

- Accepts `format: "lines"` or `"ndjson"`, and `update: "replace"`.
- `gauge.value`: the field to show when items are objects. A line or a bare number needs no field.
- `gauge.style`: `number` (the default), `dial` or `bar`. Dial and bar need `gauge.max`; `gauge.min` defaults to 0.
- `gauge.unit`: shown after the value, e.g. `"%"` or `" ms"`.
- `gauge.thresholds`: colors the value by the highest threshold it reached, e.g. `[{ at: 70, color: "orange" }, { at: 90, color: "red" }]`. Colors are CSS colors.
- The number style also shows values that aren't numbers, e.g. a status word.

## custom

Your own code draws the panel, for anything the other views don't do.

```
panel_create({ id: "flow", title: "Flow", format: "ndjson", update: "append", view: "custom", custom: { code: "…" } })
```

- Accepts every format and update mode.
- `custom.code`: JavaScript, run as a module in a sandboxed frame. It can `import` packages from cdn.jsdelivr.net, unpkg.com and esm.sh, e.g. `import * as d3 from 'https://esm.sh/d3@7'`. Nothing else is reachable: other hosts, tapet's window and the session are all off limits.
- `custom.surface`: `dom` (the default), `canvas2d` or `webgl`.
- The code gets a global `tapet`:
  - `tapet.root`: the element to draw in, filling the panel.
  - `tapet.canvas`: with `canvas2d` and `webgl`, a canvas that fills the panel, sized in device pixels. `tapet.gl`: with `webgl`, its WebGL 2 context.
  - `tapet.entries()`: the panel's items in display order, each `{ key, seq, receivedAt, value }`.
  - `tapet.onChange(listener)`: calls `listener({ added, updated, removed })` after each change, where `removed` holds keys. Returns a function that stops listening.
  - `tapet.settings()` and `tapet.onSettings(listener)`: the panel's settings, and their changes.
  - `tapet.size()`: `{ width, height, pixelRatio }`, in CSS pixels. `tapet.onResize(listener)` follows it.
- The theme's variables (`--tapet-fg`, `--tapet-series-1`, …) are set inside the frame. The window's and the panel's CSS don't reach it.
- Changing `custom.code` or `custom.surface` runs the new code in a fresh frame. Other settings reach it through `onSettings`.
- An error the code throws while it starts fails the `panel_create` or `panel_update` that ran it. Later errors come back as notices and show in the panel.
- Classic workers start in the frame, e.g. from a `blob:` URL; module workers don't. So MapLibre GL 5 runs in a custom view, and version 6, whose worker is a module, doesn't.
- For a map beyond the map view, e.g. MapLibre's full API, pipe GeoJSON features into a custom view:

  ```js
  import maplibregl from 'https://esm.sh/maplibre-gl@5'
  // MapLibre 5 needs this plugin for Hebrew and Arabic labels.
  maplibregl.setRTLTextPlugin(
    'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js',
    true,
  )
  const css = 'https://esm.sh/maplibre-gl@5/dist/maplibre-gl.css'
  document.head.append(
    Object.assign(document.createElement('link'), { rel: 'stylesheet', href: css }),
  )
  const map = new maplibregl.Map({
    container: tapet.root,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [35, 31.8],
    zoom: 7,
  })
  const features = () => ({
    type: 'FeatureCollection',
    features: tapet.entries().map((entry) => entry.value),
  })
  map.on('load', () => {
    map.addSource('items', { type: 'geojson', data: features() })
    map.addLayer({
      id: 'items',
      type: 'circle',
      source: 'items',
      paint: { 'circle-color': '#e41a1c', 'circle-radius': 6 },
    })
    tapet.onChange(() => map.getSource('items').setData(features()))
  })
  ```

  The style shows as published: unlike the map view's, it keeps country borders and names.
