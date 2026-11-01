# tapet — design

> Status: agreed on 2026-10-31, before any code was written, and kept up to date as decisions changed while building. Everything here is decided unless it appears under [Open questions](#open-questions). For what tapet does today, see [FEATURES.md](FEATURES.md).

tapet (Hebrew טפט, "wallpaper") is a display that AI agents direct over MCP to show things to their user. The agent directs the display rather than piping data through itself: large data flows from its source straight into tapet and never enters the agent's context.

## Principles

- **The agent directs, it doesn't pipe.** MCP carries control; channels (shell pipes) carry data.
- **The agent decides.** It declares data formats, writes the layout in CSS, shapes what smart prompts see, manages memory and its own pipes, and keeps its own record for resuming. Tapet never guesses.
- **Don't restrict the agent.** Expose everything: presets for standard views, primitives and custom code for the rest. Docs steer by task, never by model size.
- **Fewer exceptions, less complexity.** One data path, one update rule, no special cases.
- **Don't impose on users.** For example, cleartext keys in the config file are allowed.
- **No harness-specific code.** Whatever a particular harness needs is the agent's job.
- **Use formats models already know:** CSS, Markdown, Vega-Lite, Mermaid, GeoJSON.

## Use cases

The design was checked against these:

1. **Log summaries** (built first): `tail -f` a log into a panel whose LLM keeps a rolling summary, e.g. every 10 new lines, given the previous summary.
2. **Election map:** vote distribution per Israeli municipality.
3. **Graphs:** turn anything into a node-and-edge graph (catgraph-style), plus charts.
4. **Product data:** user and campaign data from deepcortex's nuflow platform.

## Product

- For agents only; there is no human-facing CLI beyond setup and logs.
- Public open source under Apache-2.0. Published on npm as `@deepcortexlabs/tapet`; repo in the `deepcortexlabs` GitHub org.
- macOS, Linux and Windows. Distributed through npm only (`npx -y @deepcortexlabs/tapet mcp`), with no code signing.

## Architecture

```
harness ──stdio──▶ tapet mcp ──localhost HTTP──▶ session background process ◀──MessagePort──▶ session window
                       │                                    ▲
                       └──local socket──▶ main process      │   (creates sessions only)
agent's shell:  cmd | tapet -c <addr> ──localhost HTTP──────┘
```

- **One shared Electron app, one window per harness session, with sessions fully separated.** Electron was chosen over Tauri for two reasons: agents write the CSS, HTML and JS, so a single engine (Chromium) means it renders the same everywhere; and `capturePage()` gives exact screenshots.
- **Main process:** kept tiny, because a crash there takes down every window. It creates each session's window and background process and hands out the background process's address. No session traffic passes through it.
- **Per session:**
  - an Electron `utilityProcess` that holds the session's state and channels, serves the session's HTTP API, and makes the smart LLM calls (the API keys live only here);
  - a window that talks to it over a direct `MessagePort`;
  - a separate in-memory storage partition;
  - a random session token.
- **`tapet mcp`** is the MCP server each harness starts. Sessions are created on demand, so it can't simply relay MCP: before the first `window_update` there is no session process, and `docs_get` and `session_attach` must work without one. Instead it:
  - finds the app through a fixed local socket, or launches it (Electron's single-instance lock settles launch races);
  - checks the internal protocol version;
  - asks main to create or attach a session;
  - calls that session's background process through a small internal HTTP API: `GET /attach`, a long-lived stream that keeps the session live while it's open, and `POST /rpc`.
- **Version mismatch:** only a change to the internal protocol version counts, not every release. When `tapet mcp` finds a running app speaking another version, tool calls fail with "quit tapet (Cmd-Q) and retry".
- **Security:** localhost only, per-session tokens. Requests carrying an `Origin` header are refused, which keeps browsers out. Each channel token belongs to exactly one session.
- **Network allowlist:** the window and custom views load only from a fixed list of hosts (`NETWORK_HOSTS`: `tiles.openfreemap.org` for base maps; `cdn.jsdelivr.net`, `unpkg.com` and `esm.sh` for packages custom views import). Their content security policies are generated from the list at build time, and a map's `base_map` must be on an allowed host. The list grows deliberately, one host at a time.
- **tapet's home** is `~/.tapet`, or `TAPET_HOME`, which isolates tests. It holds the control socket (`app.sock`, a named pipe on Windows), `logs/`, the downloaded `electron/`, `preferences.json`, today's token use (`usage.json`), and Electron's own data (`app-data/`). The single-instance lock is therefore per home.
- **Electron binary:** tapet downloads it itself (with `@electron/get`, cached) rather than relying on the `electron` package's install script, which pnpm 10 skips. `tapet setup` downloads in the foreground. If Electron is missing, tool calls reply with the setup command and the agent runs it; downloading inside a tool call would hit MCP timeouts.
- **Everything is HTTP,** so remote agents can come later without a redesign.

## Sessions

- **Creation:** a connection has no session and no window until its first `window_update`, which must include the window `name`.
- **Reattaching:** `session_attach(id)` reattaches to an existing session, live or frozen. It fails with a clear error if another live connection holds that session; there is never a silent takeover.
- **Session id:** random and unguessable, because it also unlocks the window. Tool results include it, and the instructions tell the agent to record it.
- **End:** a session ends when the agent calls `session_end` or its MCP connection closes. There is no grace period, because tapet can't recognize a reconnecting process. A harness that restarts `tapet mcp` comes back as a new connection, and the agent reattaches with its recorded id.
- **When a session ends:**
  - its panels freeze (they stay but stop updating) by default, or are removed if config says so;
  - tapet closes that session's channels, so pipes the agent left running die on their next write;
  - smart runs stop.
- **Status in title bars:** each panel's title bar shows a dot for live (a pipe is open), idle, or ended, plus its smart status (running, cap reached, error) when not idle.
- **`ended_panels: remove`** in the config closes an ended session's window and discards the session instead of freezing it.
- **Frozen panels** can't be removed by hand. The user asks an agent to remove them, and that agent has to attach to the session first.
- **Closing an ended session's window** asks the user to Discard or Keep the session, with a "Remember this choice" checkbox that is unchecked by default. A remembered answer is stored in `preferences.json`, a file the app writes; the config file stays the user's. Discarding frees the session's process, and reattaching fails after that. Quitting tapet never asks.
- **Window lifetime:** windows stay open until the user quits the app, and the app keeps running until then. A relaunched app starts empty. Resuming is the agent's job: the instructions tell it to keep its own record, and `window_get` returns the current setup.
- **Closed windows:** if the user closes a window, the session continues and keeps receiving data. Only an agent call that changes the window or its panels (`window_update`, `window_focus`, `panel_*`) reopens it; incoming data never does.
- **One window per session.**

## Getting data in

- **The agent runs commands itself,** under its harness's permissions, and pipes the output into a panel's channel. Tapet never runs commands or reads files.
- **Pipe command:** `panel_create` returns a ready-to-run command that runs tapet's pipe entry by absolute path, e.g. `…/node …/tapet/pipe-main.js -c 127.0.0.1:53211/c/…`. It works without a global install, and its version always matches the app.
- **Shared outputs stay blocking:** the pipe entry loads only the pipe's own code, and the pipe never creates `process.stdout` or `process.stderr` (it streams stdin by hand, since `stream.pipe()` creates `process.stdout` to compare against it). Node makes the outputs it creates non-blocking for every process that shares them, so in `tee >(<pipe>) | …` the other writer would get EAGAIN and lose data.
- **Channels:** one channel per panel. A channel is a plain HTTP endpoint.
- **Output:** `tapet -c` prints nothing on success.
- **Multiple pipes:** a channel accepts several pipes, one after another or at the same time. Each pipe is split into items on its own, and items are then ordered by when tapet received them.
- **`channel_write`:** sends small data the agent already has, such as a summary it wrote or a few numbers. It's processed exactly like a pipe.
- **Malformed items** (e.g. a broken JSON line):
  - The pipe stops: the pipe command prints the error with the exact `tapet logs` command and exits with a non-zero code. The error is also attached to the agent's next tool result.
  - `--ignore-malformed` on the pipe command skips bad items instead. It only applies to structured formats.
  - `channel_write` has no such option, because malformed data there is the agent's own bug.
- **Long-running pipes** (`tail -f …`): keeping them from blocking is the agent's job.

## Panels

A panel consists of its channel, its stored data, its view, and optionally a smart trait. Titles are required. The agent chooses panel ids, which must be simple names: a letter first, then letters, digits, `-` and `_`, at most 64 characters (e.g. `api-log`). That way, agent CSS never needs quoting or escaping.

### Data settings

| Setting     | Values                                     | Notes                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | `lines`, `ndjson`, `csv`, `whole`          | How the stream is split into items. With `whole`, each pipe's entire input is one item (a document, an image). For CSV, the first line is the header unless the agent says otherwise. **Fixed at creation.**                                                                                                |
| `update`    | `append`, `replace`, `upsert`, `patch`     | What each item does. `upsert` and `patch` match items by `key`, so every item needs the key field, graph edges included. In both modes, an item with `"_deleted": true` removes its row or node, and the marker itself is never stored. `patch` follows JSON Merge Patch (RFC 7396). **Fixed at creation.** |
| `key`       | field name                                 | Required for `upsert` and `patch`. **Fixed at creation.**                                                                                                                                                                                                                                                   |
| `retention` | `all` (default), last N items, last T time | Memory is the agent's responsibility. v1 has no automatic handling for data that outgrows memory. Doesn't apply to `replace` panels, which keep only the latest item.                                                                                                                                       |

To change a fixed setting, the agent removes the panel and creates a new one, which gets a new pipe address. Data is never cleared silently. Changing anything else leaves the data and the pipe untouched.

Tapet tracks two more properties internally:

- **shape** (records, series, graph, document, …), derived from the view and format and never set by the agent;
- **live/idle**, meaning whether any pipe is writing right now.

### Views

| View       | Shows            | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `log`      | lines            | Terminal colors (ANSI), a search box, follow.                                                                                                                                                                                                                                                                                                          |
| `table`    | rows             | Columns from `table.columns`, or from the CSV header or the fields in order of first appearance. Local sorting, virtual scrolling.                                                                                                                                                                                                                     |
| `chart`    | series           | Two engines: **uPlot** (`chart.y`, `x`, `series`, `type`: line, area, bar or points) for large time series, and **Vega-Lite** with a full spec for everything else, fed through a dataset named `tapet`. Vega's expressions run in vega-interpreter, so the window needs no eval.                                                                      |
| `graph`    | nodes and edges  | cosmos.gl for every size: a force layout on the GPU, or a hierarchical one (dagre, up to 3,000 nodes). cosmos.gl draws no labels, so tapet draws them on top. Picked by benchmark; see [Graph library](#graph-library).                                                                                                                                |
| `map`      | GeoJSON features | Built on MapLibre. Each item carries geometry and values; the agent joins them before piping. Base map: OpenFreeMap by default (positron, or dark in dark mode), configurable per panel. MapLibre 6 draws right-to-left text itself, so there's no RTL plugin. The agent sets the label language; the default is English, falling back to local names. |
| `document` | one document     | The agent declares the content type: markdown (with Mermaid, code highlighting and math), html, text or image. HTML is sanitized (no scripts) and rendered in a shadow root, so its styles stay inside it.                                                                                                                                             |
| `gauge`    | one value        | A big number, a dial or a bar, with optional min/max and thresholds.                                                                                                                                                                                                                                                                                   |
| `custom`   | anything         | Agent-written JavaScript module on a DOM, 2D canvas or WebGL surface, in a sandboxed frame without an origin, loaded from its own page with its own content security policy. Through the bridge it gets the panel's items, live updates, settings and size; there are no queries in v1. It may import packages from the allowed hosts only.            |

OpenFreeMap is the default base map because the Google tile endpoint used in the election app isn't a public API, and OpenStreetMap's tile policy rules out heavy use by apps. The base map is **neutral by default**: no country or region borders or names unless the panel sets `map.borders`, so tapet takes no side where borders are disputed. Every OpenStreetMap-based provider shows the same borders, so the choice of provider doesn't change this; the style does.

Other view settings:

- **View settings object:** each view's own settings live in an object named after it, e.g. `gauge: { value: "cpu", style: "dial", max: 100 }`. Only the current view's object is allowed, and switching views drops the previous one. Where a view can't know a field, the agent names it (`chart.y` is required); where the data says it, the view takes it from there (table columns, the graph's `id`, `source` and `target`).
- **`follow`:** keeps the newest data in view. On by default for `append` panels whose view supports it (log, table, chart).
- **Local interaction** (scroll, zoom, pan, hover, sort, search) is always on in built-in views and never reported to the agent.
- **Same bridge for all views:** built-in views use the same bridge as `custom` views. A view receives a DOM element and the bridge. Through the bridge it gets the stored entries, then live changes: entries added, updated in place, or removed, by key. Custom views get it over `postMessage`, as the `tapet` object: `entries()`, `onChange()`, `settings()`, `onSettings()`, `size()`, `onResize()`, plus `root`, `canvas` or `gl` for their surface. Views report problems with their data through the bridge, and they reach the agent as notices.
- **Loading:** views with large libraries load with the first panel that uses them: Vega-Lite, Mermaid, the graph view and the map view. The rest is bundled into the window. Measured with `bench/startup.ts`, a window with one log panel opens in about 265–285 ms with 1.4 MB of JavaScript, against 251 ms and 0.5 MB before the other views existed; bundling everything had reached 345 ms and 4 MB.
- **RTL:** built-in views support right-to-left text, and the agent sets the direction in CSS. Log lines take their direction from their own text, so a Hebrew line reads right to left without any CSS.

### Presets

A preset is a named bundle of settings. The agent names one and overrides any setting. Presets hold no field names, so e.g. `timeseries` needs `chart.y` from the agent.

| Preset       | format                    | update                                         | view                | Other defaults |
| ------------ | ------------------------- | ---------------------------------------------- | ------------------- | -------------- |
| `log`        | lines                     | append                                         | log                 | follow         |
| `timeseries` | ndjson                    | append                                         | chart (uPlot)       | follow         |
| `table`      | ndjson                    | append                                         | table               | follow         |
| `graph`      | ndjson                    | upsert by `id` (edges need their own `id` too) | graph               | —              |
| `document`   | whole                     | replace                                        | document (markdown) | —              |
| `gauge`      | lines                     | replace                                        | gauge               | —              |
| `map`        | ndjson (GeoJSON features) | upsert by feature `id`                         | map                 | —              |

### Validation and errors

Which data each view accepts:

| View         | Formats       | Updates               | `follow` |
| ------------ | ------------- | --------------------- | -------- |
| log          | lines         | append                | yes      |
| table, chart | ndjson, csv   | append, upsert, patch | yes      |
| graph        | ndjson, csv   | append, upsert, patch | no       |
| map          | ndjson        | append, upsert, patch | no       |
| document     | whole         | replace, append       | no       |
| gauge        | lines, ndjson | replace               | no       |
| custom       | any           | any                   | no       |

- **Contradictory settings** are rejected with an explanation. Examples: `upsert` without a `key`, `follow` on a `replace` panel, a graph view fed `lines`.
- **First render:** `panel_create` and `panel_update` wait for the first render, then return either success or the error. A custom view's render ends when its code has run, so an error it throws while starting is the call's error, and isn't repeated as a notice.
- **Later errors** are attached to the session's next tool result.

## Smart trait

Any panel can have one. It is powered by AI SDK with OpenAI, Anthropic and Gemini.

```js
smart: {
  prompt: "Summarize new errors and warnings. Update the previous summary.",
  every: { items: 10 },                  // or { seconds: 60 }; omit to run only via smart_run
  history: 5,                            // past outputs each run sees; default 1
  model: "anthropic/claude-haiku-4-5"    // optional; default comes from config
}
```

- **Triggers:** `every` (N new items or T seconds), and the agent calling `smart_run`.
- **Input:** the last `history` outputs plus the items that are new since the last successful run: entries whose sequence number is higher, so updated rows in `upsert` and `patch` panels count too. The agent shapes the input through the pipe (e.g. `grep` upstream), the prompt and the frequency.
- **Skipping:** scheduled runs with no new items are skipped; `smart_run` always runs. A trigger that fires while a run is in progress is skipped, and the next run covers everything since the last one.
- **Token budget** (`smart_input_tokens` in config; tokens are estimated at about 4 characters each):
  - When the pending items would exceed the budget, the run starts early (only for panels with `every`).
  - If items still overflow (for example, a burst during a run), the overflow is split into chunks and summarized with the panel's model. The run gets those summaries in place of the dropped items, followed by the newest items that fit. These extra calls count toward the cap.
  - At most 5 chunks are summarized per run. Anything older is skipped, and the run is told how many items that was, so a huge burst can't trigger hundreds of calls.
  - Past outputs that don't fit are dropped oldest-first.
- **Output:** the latest output, as sanitized markdown, inside the panel in `.tapet-smart-output`, which the agent can position with CSS. All outputs are kept for the panel's lifetime. `smart_read({ panel, last })` returns the last N outputs, and `smart_run` returns its own output.
- **Errors** (a missing key, an unknown model, a network failure) become the run's output and the panel's status, and a notice in the agent's next tool result. Repeats of the same failure don't add notices.
- **Cap:** one global daily cap, counted in tokens, set in the user's config (default 2M). The main process keeps today's total in `usage.json`, keyed by the local date, so it resets at local midnight and survives restarts. Sessions check it before each run and report tokens after; runs already in flight may overshoot slightly.
- **Removing it:** `panel_update({ id, smart: null })`. `null` clears any optional panel setting.
- **Models:** listed in config as `provider/model` (e.g. `google/gemini-3`), with no aliases. `models_get` returns the list.
- **Isolation:** keys and LLM calls stay in the session's background process and never reach panel code.
- **Frozen sessions:** runs stop when the session freezes.

## Layout and window

- **Only the agent arranges panels.** There is no manual layout, in v1 or later.
- **Real CSS:**
  - one global stylesheet (the `css` field of `window_update`) plus each panel's own `css`, which applies only inside that panel (wrapped in `@scope ([data-panel="<id>"])`);
  - a documented, stable DOM: the root is `#tapet`, each panel is `[data-panel="<id>"]` in creation order, there are documented classes for the title bar, body and smart output, and theme tokens are CSS variables;
  - CSS is scoped per window.
- **Window:** `name` is required. The agent sets size, position and always-on-top through `window_update`, and brings the window to the front with `window_focus`. The config's `window_focus` decides whether windows take focus on their own: `never` (default), `open`, or `update` (on every agent window or panel change).
- **Panel titles** are required and shown in a title bar that CSS can hide, along with the status dot and smart status.
- **Theme:** follows the OS light/dark setting; agent CSS can override it.
- **App presence:** a Dock app by default. With `app_presence: menu_bar`, macOS hides the Dock icon, every OS gets a tray icon whose menu lists the open windows plus "Quit tapet", and windows stay out of the taskbar.
- **Reading the window back:**
  - `window_get` returns the setup as declared;
  - `window_inspect` returns computed geometry: panel boxes, overflow, zero-size panels;
  - `window_screenshot` returns what's actually rendered, for the whole window or one panel, in physical pixels (2× on Retina) with no downscaling in v1. If a model API rejects the image size, the agent gets a clear error.

## MCP tools

| Tool                | Purpose                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window_update`     | Window settings: `name` (required on the first call), size, position, always-on-top, global `css`. The first call creates the session and returns its id. |
| `window_get`        | The full current setup: window settings, CSS and panel settings. No data.                                                                                 |
| `window_focus`      | Bring the window to the front.                                                                                                                            |
| `window_screenshot` | The whole window or one panel.                                                                                                                            |
| `window_inspect`    | Computed geometry.                                                                                                                                        |
| `panel_create`      | Create a panel. Fails if the id already exists. Returns the pipe command.                                                                                 |
| `panel_update`      | Change panel settings. Fails if the id doesn't exist or a fixed data setting is included. Never touches data or the pipe.                                 |
| `panel_remove`      | Remove a panel.                                                                                                                                           |
| `channel_write`     | Send data into a panel's channel.                                                                                                                         |
| `smart_run`         | Run a panel's smart prompt now and return the output.                                                                                                     |
| `smart_read`        | Return a panel's last N smart outputs.                                                                                                                    |
| `session_attach`    | Reattach to an existing session by id.                                                                                                                    |
| `session_end`       | End the session.                                                                                                                                          |
| `models_get`        | List the configured models.                                                                                                                               |
| `docs_get`          | Usage docs by topic.                                                                                                                                      |

- **Field rule:** fields you send replace those fields; fields you don't send stay as they are; `null` clears an optional setting. There's no deeper merging.
- **Naming:** object-first snake_case. Dots aren't allowed, because Anthropic's and OpenAI's APIs only accept letters, digits, `_` and `-` in tool names.

## CLI

| Command                                | Run by            | Purpose                               |
| -------------------------------------- | ----------------- | ------------------------------------- |
| `tapet mcp`                            | the harness       | The stdio MCP server.                 |
| `tapet setup`                          | the agent or user | Download Electron, in the foreground. |
| `tapet -c <addr> [--ignore-malformed]` | the agent's pipes | Send data into a channel.             |
| `tapet logs --session <id>`            | the agent or user | Show a session's logs.                |

Agents get the full-path form of these commands from tool results. MCP controls the window and the CLI moves data. The only overlap is sending data (`channel_write` vs. pipes), and the two paths behave identically.

## Agent guidance

- **Server instructions** are loaded into every session, so they stay short:
  - record your tapet session id;
  - resuming is your job: keep your own record (`window_get` helps);
  - don't let long-running pipes block you;
  - set retention yourself, because memory is your responsibility;
  - call `docs_get` for details.
- **`docs_get` topics:**
  - overview
  - panels and presets
  - formats and updates, including the merge-patch rules
  - views and their settings
  - CSS: DOM structure, classes, theme tokens
  - custom views and the bridge
  - smart
  - pipes: the pipe command, malformed data, `--ignore-malformed`
  - sessions: ids, attaching, ending, freezing
  - troubleshooting: missing Electron and the setup command, reading logs
- **Steer by task:** presets for standard views, custom views for tailored ones.
- **Evals:** an eval set run across several models tunes the instructions.

## Config

- **Layers,** lowest to highest; a setting in a higher layer replaces the same setting below it, and each provider counts as one setting (a project can swap the OpenAI key without dropping the user's Anthropic key):
  1. the standard key names (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`), from the environment or a `config.env` file;
  2. the user's `~/.config/tapet/config.json`, or the file `TAPET_CONFIG` names;
  3. the project's `.tapet/config.json`, in `tapet mcp`'s working directory.
- **Secrets as `${NAME}` references:** any JSON string may reference a variable, e.g. `"api_key": "${CLAUDE_API_KEY}"`. Variables come from the environment, then `~/.config/tapet/config.env`, then the project's `.tapet/config.env`, and a `config.env` may be a 1Password-mounted file. Keys never have to sit in the JSON, so a project's config can be committed. A reference with no value is reported and its setting ignored; `$${` is a literal `${`. We chose references over a list of JSON paths: the reference sits where the value goes, nothing breaks when settings move, and the syntax is the one shells, docker-compose and Claude Code's `.mcp.json` use.
- **Reading:** files are read as streams, which works with 1Password's named pipes. `tapet mcp` reads every layer, with its own environment and working directory, each time a session is created or reattached, and hands the session process its settings over the internal API. So the shared app never depends on the environment of the session that launched it.
- **App-wide settings** (`daily_token_cap`, `app_presence`) come only from the user's layers, which the app reads when it starts. A project can't raise the cap.
- **Problems** are reported as notices on the next tool result; tapet ignores the broken settings and keeps the rest.
- **Contents** (JSON, snake_case):
  - `providers`: `anthropic`, `openai` and `google`, each with `api_key`; `openai` also takes `base_url`, for proxies and local OpenAI-compatible servers (tapet then uses the chat completions API, and the key is optional)
  - `models` (`provider/model`) and `default_model` (defaults to the first model)
  - `smart_input_tokens` (default 50,000)
  - `window_focus`: `never` (default), `open` or `update`
  - `ended_panels`: `keep` (default) or `remove`
  - `daily_token_cap` (default 2M)
  - `app_presence`: `dock` (default) or `menu_bar`
  - the base map default comes with the map view

## Diagnostics

- Logs are kept per session and read with `tapet logs --session <id>`. Every error message includes the exact command.
- No telemetry in v1.

## Development

- **Repo:** a pnpm workspace. The internal packages are private and get bundled into the one published package.
- **Language and runtime:** TypeScript 6. (svelte-check doesn't support TypeScript 7 yet.) The CLI and MCP server need Node 24+; the app uses Electron's bundled Node.
- **Tooling** (chosen for fitness and for how well AI agents work with it):
  - **electron-vite** builds the app: main process, preload, windows and background processes.
  - **esbuild** bundles the CLI and MCP server. Node won't strip TypeScript types inside `node_modules`, so these must ship as JS.
  - **Svelte 5** for the window frame and the DOM-based views, type-checked with svelte-check. The official Svelte MCP server's autofixer checks agent-written Svelte.
  - **Vitest**, whose agent reporter prints only failures when it runs inside a coding agent.
  - **Playwright** `_electron` for end-to-end tests.
  - **Oxlint + Oxfmt** for linting and formatting.
- **CI:** GitHub Actions runs the full suite on macOS, Windows and Linux (Linux under xvfb).
- **First release:** 0.1.0.

## Graph library

`bench/graph.ts` rendered the same synthetic graphs with sigma.js (graphology, ForceAtlas2 in a worker) and cosmos.gl, each in a fresh Electron window. cosmos.gl was picked; sigma.js isn't kept.

| Graph                  | First frame (sigma.js → cosmos.gl) | During layout | Renderer memory |
| ---------------------- | ---------------------------------- | ------------- | --------------- |
| 1k nodes, 1.5k edges   | 92 ms → 712 ms                     | 60 → 60 fps   | 167 → 132 MB    |
| 100k nodes, 150k edges | 1.8 s → 0.5 s                      | 54 → 60 fps   | 675 → 202 MB    |
| 1M nodes, 1.5M edges   | 46.5 s → 1.4 s                     | — → 9 fps     | 3.5 GB → 528 MB |
| 1.2k nodes, 72k edges  | 402 → 341 ms                       | 60 → 82 fps   | 327 → 161 MB    |
| 12k nodes, 1M edges    | 6.7 s → 0.7 s                      | 16 → 59 fps   | 1.4 GB → 309 MB |

sigma.js starts faster only on tiny graphs. At 1M nodes its layout produced no step in the measured 5 seconds.

## Build order

1. **Trait system core:** formats, update modes (including merge patch), retention, presets and validation. Pure TypeScript with no Electron, covered by unit tests.
2. **The plain live log, end to end:** app, sessions, `tapet mcp`, log view, pipes, screenshots.
3. **Smart trait.**
4. **The remaining views.**

## Not in v1

- User input reaching the agent (two-way widgets). The only two-way feature is screenshots, and idle agents are never woken.
- Remote agents (important, comes later).
- Plugins (v2). Saving views is the agent's job.
- More than one window per session (maybe v2).
- Automatic handling for data that outgrows memory.
- Blurring panels in screenshots, and a screenshot size setting (v2).
- Telling the agent that the user closed its window.
- Routing one channel to several panels.
- Ordering simultaneous pipes by the data's own timestamps.
- Smart outputs feeding other panels, and per-panel caps. Ad-hoc smart prompts are out entirely.
- Loading graph neighbors on demand.

## Open questions

1. **Evals:** which models? Proposed: Claude (Opus, Sonnet, Haiku), GPT and Gemini running the use cases above with synthetic data, possibly plus a small local model.

## Example

```js
window_update({
  name: 'api logs',
  width: 1200,
  height: 800,
  css: '#tapet { display: grid; grid-template-columns: 2fr 1fr; gap: 8px }',
})
// → { session: "s_8f3k2…", errors: [] }

panel_create({
  id: 'api-log',
  title: 'API log',
  preset: 'log',
  retention: { last: 50000 },
  css: '.tapet-smart-output { font-size: 14px }',
  smart: {
    prompt: 'Summarize new errors and warnings. Update the previous summary.',
    every: { items: 10 },
    history: 5,
  },
})
// → { pipe: "…/node …/tapet/pipe-main.js -c 127.0.0.1:53211/c/…" }
```

The agent then runs the pipe from its own shell (and keeps it from blocking itself):

```bash
tail -f app.log | …/node …/tapet/pipe-main.js -c 127.0.0.1:53211/c/…
```

Later calls such as `panel_update({ id: "api-log", smart: { … } })` change only the smart settings; the log's data and pipe are untouched. `smart_read({ panel: "api-log", last: 3 })` returns the three latest summaries.
