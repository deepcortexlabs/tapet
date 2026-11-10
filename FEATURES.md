# tapet features

The official list of what tapet does today.

## Reading this file

- Each line is one feature, as it works now. Nothing here is planned, in progress or removed.
- This file answers "what can tapet do?". The reasons behind the design are in [DESIGN.md](DESIGN.md), and how agents use each feature is in [packages/cli/docs](packages/cli/docs).
- If this file and the code disagree, one of them has a bug: check the code, then fix whichever is wrong.

## Updating this file

- Update it in the same commit as the change in behavior: add, rewrite or delete the feature's line.
- Describe current behavior only, in the present tense. No history ("now", "no longer", "new", dates, versions) and no plans ("coming", "soon", "TODO").
- One line per feature: a bold name, then what it does. Use the names agents see (tools, settings, values) and leave the details to the agent docs.
- Rewrite a changed feature's line instead of appending to it. A removed feature loses its line.
- Put a new feature in the section it belongs to. Add a section only when none fits.

## Agents

- **MCP server:** `tapet mcp` serves tapet's tools over stdio to any harness that runs MCP servers.
- **Docs for agents:** `docs_get` returns topics: overview, panels, formats, views, css, pipes, smart, config, sessions, troubleshooting.
- **Validation:** invalid settings are rejected with every issue at once, each with its path and how to fix it. Unknown settings are named.
- **Notices:** problems since the last call (render errors, malformed pipes, data a view can't show, config issues) come back with the next tool result.

## Window

- **One window per session:** the first `window_update` opens it. `name` sets the title, and `width`, `height` (at least 200 px), `x`, `y` and `always_on_top` size and place it.
- **Layout in CSS:** a global stylesheet from `window_update({ css })`, plus each panel's `css`, scoped to that panel. Panels stack vertically by default.
- **Theme:** follows the system's light or dark mode, with `--tapet-*` variables for colors, fonts and chart series colors.
- **Screenshots:** `window_screenshot` returns a PNG of the window or one panel, at full screen resolution.
- **Inspection:** `window_inspect` returns each panel's box and flags panels that overflow or have zero size.
- **Reopening:** `window_focus` brings the window to the front. It and the other window and panel calls reopen a window the user closed; data never does.
- **Reading back:** `window_get` returns the window settings, the global CSS and every panel's settings, without data.

## Panels

- **Lifecycle:** `panel_create` returns a pipe command. `panel_update` replaces the settings it's given, where `null` clears an optional one. `panel_remove` closes the panel's pipes.
- **Ids and titles:** ids are simple names (letters, digits, `-` and `_`, up to 64), used in CSS as `[data-panel=<id>]`. The title is required and shows in the title bar.
- **Presets:** `log`, `table`, `timeseries` (chart), `graph`, `map`, `document` and `gauge` fill in format, update and view. Explicit settings win.
- **Fixed settings:** `format`, `header`, `update` and `key` can't change after creation.
- **View settings:** an object named after the view, e.g. `gauge: { max: 100 }`. Only the current view's object is allowed, and switching views drops the previous one.
- **Retention:** `all`, `{ last: <items> }` or `{ seconds: <seconds> }`. It doesn't apply to `replace` panels.
- **Follow:** append panels in the log, table and chart views keep the newest data in view. Scrolling or zooming away pauses it, "Jump to latest" or a double-click resumes it, and `follow` overrides it.
- **Expanding:** double-clicking a panel's title bar expands it over most of the window while the layout stays as it is underneath. Clicking outside it, Escape or another double-click puts it back. `window_inspect` marks it `expanded`.
- **Status:** the title-bar dot shows live (a pipe is feeding the panel), idle or ended. The window shows "No agent attached" or "Session ended at …" when no agent holds the session.

## Data

- **Pipes:** `<command> | <pipe>` streams standard input into a panel. It prints nothing on success. On an error it prints why and how to read the session log, and exits non-zero: 75 when the session has ended but can be resumed, 1 otherwise.
- **Many pipes:** several pipes can feed one panel, one after another or at once. Simultaneous items are ordered by arrival. One command can feed several panels through `tee >(<pipe>)` without losing data.
- **Feeders:** `window_update` returns `run`. `<run> <command>` runs a feeder that tapet stops, with everything it started, when the session ends, is discarded or tapet quits. It exits 75 when the session can be resumed, 1 otherwise.
- **channel_write:** sends data the agent already has, processed exactly like a pipe.
- **Formats:** `lines`, `ndjson`, `csv` (RFC 4180, header by default) and `whole` (each pipe's input is one item). Text is UTF-8, with LF or CRLF line endings.
- **Update modes:** `append`, `replace` (keeps only the latest item), `upsert` by `key`, and `patch` by `key` (JSON Merge Patch, RFC 7396). In upsert and patch, `"_deleted": true` removes the item.
- **Malformed data:** stops the pipe and is reported, keeping the items before it. `--ignore-malformed` skips bad items instead.

## Views

- **log:** one line per item, with terminal colors, case-insensitive search with a match count, and follow.
- **table:** columns from the CSV header, the fields in order of first appearance, or `table.columns`. Virtual scrolling, sorting by clicking a header (numbers by value), rows updated in place, and objects shown as JSON.
- **chart:** uPlot time series (`chart.y` up to 8 fields, `x` or arrival time, `x_type`, `series` split by a field, `type` line, area, bar or points) with zoom, a legend and a hover readout. Or any Vega-Lite `spec`, fed through its `tapet` dataset.
- **graph:** nodes and edges from items with an `id` or with `source` and `target`; an edge list alone works. A GPU force layout that handles a million nodes, or a `hierarchical` one; `label`, `color` and `size` from fields; labels that don't overlap, details on hover, zoom, pan and drag.
- **map:** GeoJSON features (points, lines, polygons) over an OpenFreeMap base map: `base_map` `light`, `dark`, the theme's when unset, or none with `false`. The base map shows no country or region borders or names unless `borders` is on. Features style themselves with simplestyle-spec properties (`marker-color`, `marker-size`, `fill`, `stroke` and their widths and opacities), `sort-key` for draw order and `label` for text. A `color_by` scale with a legend, `colors`, `tooltip` properties and base map labels in `label_language`; zooms to the data when it first arrives.
- **Map layers:** `map.layers` draws the panel's features with MapLibre layers (`circle`, `fill`, `line`, `symbol`, `heatmap`, `fill-extrusion`) in place of tapet's, checked by MapLibre's validator. `map.legend` lists categories with their colors; without it, the legend reads them from a layer's `match` on a property.
- **document:** `document.content` is `markdown` (highlighted code, KaTeX math, Mermaid diagrams), `html` (sanitized, no scripts, its styles stay inside it), `text` or `image`. `replace` shows the latest document; `append` stacks them.
- **gauge:** the latest value as a number, dial or bar, with `min`, `max`, `unit` and color `thresholds`. `gauge.value` picks the field when items are objects.
- **custom:** your JavaScript module in a sandboxed frame, with a `tapet` object for the panel's data, settings and size, on a `dom`, `canvas2d` or `webgl` surface. It can import packages from the allowed CDNs; an error while it starts fails the call that ran it.
- **Right-to-left text:** log lines, table cells, and markdown and text documents read right to left when their text does.
- **Allowed hosts only:** the window and custom views load from the network only from tapet's allowed hosts: tiles.openfreemap.org (base maps), and cdn.jsdelivr.net, unpkg.com and esm.sh (packages for custom views).

## Smart trait

- **Rolling LLM output:** any panel can have `smart: { prompt, every, history, model }`. Its output shows in the panel as markdown, and each run sees its last `history` outputs.
- **Triggers:** `every: { items }` or `every: { seconds }` (skipped when nothing is new), or `smart_run`.
- **Input budget:** `smart_input_tokens`. Runs start early when new data would exceed it, and overflow is summarized in up to 5 chunks per run.
- **Reading outputs:** `smart_read` returns the last N outputs, each with its time, model, tokens and any error.
- **Status:** the title bar shows running, cap reached or error.
- **Providers:** Anthropic, OpenAI (including OpenAI-compatible servers through `base_url`) and Google. `models_get` lists the configured models.
- **Daily token cap:** `daily_token_cap`, 2,000,000 by default, shared by the whole app and reset at local midnight.

## Config

- **Layers:** standard key names from the environment or `config.env`, then `~/.config/tapet/config.json` (or `TAPET_CONFIG`), then the project's `.tapet/config.json`. Each setting, and each provider, is replaced as a whole.
- **Secret references:** `${NAME}` in any string, filled from the environment, `~/.config/tapet/config.env` and `.tapet/config.env`. `$${` is a literal `${`. A missing variable is reported, and only its setting is ignored.
- **When it's read:** when a session starts or is reattached. Broken settings are reported and ignored; the rest applies.
- **Behaviors:** `window_focus` (`never`, `open`, `update`), `ended_panels` (`keep`, `remove`) and `app_presence` (`dock`, `menu_bar`). App-wide settings come only from the user's own layers.

## Sessions

- **Created on demand:** the first `window_update` creates the session and returns its id.
- **Detaching:** a closed MCP connection only detaches the session. Pipes keep flowing and panels keep updating; smart runs pause while the window is closed.
- **Idle timeout:** `window_update({ idle_timeout })`, `{ seconds }` or `"never"`, an hour by default, ends a detached session after that long with no pipe open.
- **Ending:** `session_end` or the idle timeout ends the session. Its panels stay visible but frozen, and its pipes close. With `ended_panels: remove`, the window closes and the session is discarded.
- **Reattaching:** `session_attach` revives a live or ended session by id. It fails while another live connection holds it.
- **Closing a session no agent holds:** closing the window of a detached or ended session asks whether to discard or keep it, with "Remember this choice".
- **Isolation:** each session has its own window, background process, storage partition and token.

## App

- **One shared app:** a single Electron app serves every agent. `tapet mcp` finds it through a local socket, or starts it.
- **Version check:** when the running app speaks another internal protocol version, tool calls fail and ask the user to quit tapet and retry.
- **Menu-bar mode:** `app_presence: menu_bar` hides the Dock icon and lists open windows in a tray menu.
- **Setup:** `tapet setup` downloads tapet's pinned Electron. When it's missing, tool calls say what to run.
- **Session logs:** `tapet logs --session <id>` shows a session's tool calls, pipes, malformed data and render errors.
- **Home folder:** `~/.tapet`, or `TAPET_HOME`.
- **Local only:** tapet listens on localhost, with a token per session, and refuses requests that carry an `Origin` header.
- **Platforms:** macOS, Linux and Windows.
