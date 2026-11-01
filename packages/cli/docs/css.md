# CSS

You arrange and style the window with real CSS. The user can't rearrange anything by hand.

## Structure

```
#tapet                                  the window's root
  section.tapet-panel[data-panel=<id>]  one per panel, in creation order
    header.tapet-title                  the panel's title bar
      span.tapet-dot[data-state]        live, idle or ended
      span.tapet-title-text             the title
      span.tapet-smart-status           the smart trait's status, when not idle
    div.tapet-smart-output              the latest smart output, as markdown
    div.tapet-body                      fills the rest of the panel
      div.tapet-view                    the view
```

Each view's own classes, inside `.tapet-view`:

- **log:** `.tapet-log-search` (the search box), `.tapet-log-lines` (the scrolling area), `.tapet-log-line` (one line).
- **table:** `.tapet-table-header` (the header row), `.tapet-table-heading` (one column's header), `.tapet-table-row` (one row), `.tapet-table-cell` (one cell). Column widths are the `grid-template-columns` of `.tapet-table-header, .tapet-table-row`. Rows have a fixed height of 24 px, so change their content, not their height.
- **chart:** `.tapet-chart` (with `data-type` set to the uPlot chart type), `.tapet-chart-tooltip` (the readout when hovering), uPlot's own `.u-legend` and `.u-over`. Vega-Lite charts are SVG with Vega's classes, e.g. `.mark-rect`.
- **graph:** `.tapet-graph-canvas` (the graph, drawn with WebGL), `.tapet-graph-labels` (the labels, drawn on their own canvas), `.tapet-graph-tooltip` and `.tapet-graph-count`. Node colors come from the series variables below.
- **map:** `.tapet-map-canvas` (the map, drawn by MapLibre), `.tapet-map-info` (the legend and the feature count), `.tapet-map-legend` and `.tapet-map-tooltip`. MapLibre's own controls use its `.maplibregl-*` classes.
- **custom:** `.tapet-custom-frame` (the sandboxed frame) and `.tapet-custom-error`. Your CSS doesn't reach inside the frame; the code styles its own content, and gets the theme variables there.
- **document:** `.tapet-document` (the scrolling area), `.tapet-document-item` (one document), `.tapet-document-markdown`, `.tapet-document-text`, `.tapet-document-image`, `.tapet-mermaid` (a diagram). HTML documents style themselves: your CSS doesn't reach inside them.
- **gauge:** `.tapet-gauge` (with `data-style` set to number, dial or bar), `.tapet-gauge-value`, `.tapet-gauge-unit`, `.tapet-gauge-dial`, `.tapet-gauge-bar`, `.tapet-gauge-bar-fill`.

`.tapet-empty` is the message a view shows before data arrives.

## Where CSS goes

- `window_update({ css })`: one global stylesheet. Use it for the layout.
- A panel's `css` (in `panel_create` or `panel_update`): applies only inside that panel, as if wrapped in `@scope ([data-panel="<id>"])`.

By default, panels are stacked vertically and share the window's height. Your CSS overrides that. For example:

```css
#tapet {
  display: grid;
  grid-template-columns: 2fr 1fr;
  grid-auto-rows: 1fr;
  gap: 8px;
}
[data-panel='api-log'] {
  grid-row: span 2;
}
```

Hide a title bar with `.tapet-title { display: none }` in that panel's `css`.

## Theme variables

The theme follows the user's light or dark mode. Use these variables to fit in, or override them:

`--tapet-bg`, `--tapet-fg`, `--tapet-muted`, `--tapet-border`, `--tapet-panel-bg`, `--tapet-accent`, `--tapet-font`, `--tapet-mono`.

Charts also use `--tapet-grid` (gridlines), `--tapet-axis` (baselines) and `--tapet-series-1` to `--tapet-series-8` (series colors, assigned in that order). The default order keeps neighboring series distinct for color-blind readers. To recolor one chart, set them in its panel's `css`, e.g. `:scope { --tapet-series-1: #e34948 }`.

## Checking your layout

- `window_inspect` returns each panel's box, and flags panels that overflow or have zero size.
- `window_screenshot` shows what the user actually sees.
