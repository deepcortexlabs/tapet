# Views

Views available in this version: **log**, **table**, **document** and **gauge**. Coming next: chart, graph, map and custom. Any panel can also carry a smart output (see `smart`).

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
- The window doesn't load images from the network: in markdown and HTML, use `data:` URLs.

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
