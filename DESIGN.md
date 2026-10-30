# tapet — design

> Status: agreed on 2026-10-31, before any code was written. Everything here is decided unless it appears under [Open questions](#open-questions).

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
- **tapet's home** is `~/.tapet`, or `TAPET_HOME`, which isolates tests. It holds the control socket (`app.sock`, a named pipe on Windows), `logs/`, the downloaded `electron/`, `preferences.json`, and Electron's own data (`app-data/`). The single-instance lock is therefore per home.
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
- **Ended-session indicator:** for now, an ended session's window title gets " (ended)". This is interim until open question #2 (status display) is answered.
- **Frozen panels** can't be removed by hand. The user asks an agent to remove them, and that agent has to attach to the session first.
- **Closing an ended session's window** asks the user to Discard or Keep the session, with a "Remember this choice" checkbox that is unchecked by default. A remembered answer is stored in `preferences.json`, a file the app writes; the config file stays the user's. Discarding frees the session's process, and reattaching fails after that. Quitting tapet never asks.
- **Window lifetime:** windows stay open until the user quits the app, and the app keeps running until then. A relaunched app starts empty. Resuming is the agent's job: the instructions tell it to keep its own record, and `window_get` returns the current setup.
- **Closed windows:** if the user closes a window, the session continues and keeps receiving data. Only an agent call that changes the window or its panels (`window_update`, `window_focus`, `panel_*`) reopens it; incoming data never does.
- **One window per session.**

## Getting data in

- **The agent runs commands itself,** under its harness's permissions, and pipes the output into a panel's channel. Tapet never runs commands or reads files.
- **Pipe command:** `panel_create` returns a ready-to-run command that uses the absolute path to tapet's own binary, e.g. `~/.npm/_npx/…/.bin/tapet -c 127.0.0.1:53211/ch_a1…`. It works without a global install, and its version always matches the app.
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

| View       | Shows            | Notes                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log`      | lines            | Terminal colors (ANSI), a search box, follow.                                                                                                                                                                                                                                          |
| `table`    | rows             | Columns from the mapping, local sorting, virtual scrolling.                                                                                                                                                                                                                            |
| `chart`    | series           | Two engines: **uPlot** with tapet's simple mapping (x, y, series; line/area/bar/points) for large time series, and **Vega-Lite** with a full spec for everything else.                                                                                                                 |
| `graph`    | nodes and edges  | One WebGL view for every size, with force-directed and hierarchical layouts. The library will be picked by benchmark (sigma.js vs cosmos.gl at 1k, 100k and 1M nodes).                                                                                                                 |
| `map`      | GeoJSON features | Built on MapLibre. Each item carries geometry and values; the agent joins them before piping. Base map: OpenFreeMap by default, configurable in config and per panel. RTL text plugin bundled. The agent sets the label language; the default is English, falling back to local names. |
| `document` | one document     | The agent declares the content type: markdown (with Mermaid, code highlighting and math), html, text or image.                                                                                                                                                                         |
| `gauge`    | one value        | A big number, a dial or a bar, with optional min/max and thresholds.                                                                                                                                                                                                                   |
| `custom`   | anything         | Agent-written code on a DOM, 2D canvas or WebGL surface. Through the bridge it gets the panel's current items, live updates and size; there are no queries in v1. It may load libraries from the network: open for now, later limited to a predefined set.                             |

OpenFreeMap is the default base map because the Google tile endpoint used in the election app isn't a public API, and OpenStreetMap's tile policy rules out heavy use by apps.

Other view settings:

- **`mapping`:** which data fields go where. The agent always specifies it; tapet never guesses.
- **`follow`:** keeps the newest data in view. On by default for `append` panels whose view supports it (log, table, chart).
- **Local interaction** (scroll, zoom, pan, hover, sort, search) is always on in built-in views and never reported to the agent.
- **Same bridge for all views:** built-in views use the same bridge as `custom` views. A view receives a DOM element and the bridge. Through the bridge it gets the stored entries, then live changes: entries added, updated in place, or removed, by key.
- **RTL:** built-in views support right-to-left text, and the agent sets the direction in CSS. Log lines take their direction from their own text, so a Hebrew line reads right to left without any CSS.

### Presets

A preset is a named bundle of settings. The agent names one and overrides any setting. Presets never include a mapping.

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
- **First render:** `panel_create` and `panel_update` wait for the first render, then return either success or the error (message, stack trace, console errors).
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
- **Input:** the last `history` outputs plus the items that arrived since the last run. The agent shapes the input through the pipe (e.g. `grep` upstream), the prompt and the frequency.
- **Skipping:** scheduled runs with no new items are skipped; `smart_run` always runs. A trigger that fires while a run is in progress is skipped, and the next run covers everything since the last one.
- **Token budget** (set in config):
  - When the pending items would exceed the budget, the run starts early.
  - If items still overflow (for example, a burst during a run), the overflow is split into chunks and summarized with the panel's model. The run gets those summaries in place of the dropped items, followed by the newest items that fit. These extra calls count toward the cap.
  - Past outputs that don't fit are dropped oldest-first.
- **Output:** markdown inside the panel, in a documented element the agent positions with CSS. All outputs are kept for the panel's lifetime. `smart_read({ panel, last })` returns the last N outputs, and `smart_run` returns its own output.
- **Cap:** one global daily cap, counted in tokens, set in config. The default is 2M.
- **Models:** listed in config as `provider/model` (e.g. `google/gemini-3`), with no aliases. `models_get` returns the list.
- **Isolation:** keys and LLM calls stay in the session's background process and never reach panel code.
- **Frozen sessions:** runs stop when the session freezes.

## Layout and window

- **Only the agent arranges panels.** There is no manual layout, in v1 or later.
- **Real CSS:**
  - one global stylesheet (the `css` field of `window_update`) plus each panel's own `css`, which applies only inside that panel (wrapped in `@scope ([data-panel="<id>"])`);
  - a documented, stable DOM: the root is `#tapet`, each panel is `[data-panel="<id>"]` in creation order, there are documented classes for the title bar, body and smart output, and theme tokens are CSS variables;
  - CSS is scoped per window.
- **Window:** `name` is required. The agent sets size, position and always-on-top through `window_update`, and brings the window to the front with `window_focus`. By default, windows never take focus on their own (configurable).
- **Panel titles** are required and shown in a title bar that CSS can hide.
- **Theme:** follows the OS light/dark setting; agent CSS can override it.
- **App presence:** a Dock app by default; a menu-bar mode is configurable.
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

- **Field rule:** fields you send replace those fields; fields you don't send stay as they are. There's no deeper merging.
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
  - views and their mappings
  - CSS: DOM structure, classes, theme tokens
  - custom views and the bridge
  - smart
  - pipes: the pipe command, malformed data, `--ignore-malformed`
  - sessions: ids, attaching, ending, freezing
  - troubleshooting: missing Electron and the setup command, reading logs
- **Steer by task:** presets for standard views, custom views for tailored ones.
- **Evals:** an eval set run across several models tunes the instructions.

## Config

- **One file holds everything,** keys included, wherever the user wants it: cleartext, or a 1Password-mounted env file. The format is `.env` or JSON, and the path comes from `TAPET_CONFIG`.
- **1Password mounts** are named pipes, so tapet reads the file as a stream, once when a session starts, with no size checks and no file watching.
- **Plain environment variables** also work, since AI SDK reads `OPENAI_API_KEY` and the like. However, the shared app only sees the environment of the session that launched it.
- **Contents:**
  - providers and keys
  - allowed models (`provider/model`) and the default
  - daily token cap (default 2M)
  - token budget for a smart run's input
  - base map (default OpenFreeMap)
  - window focus (default: never take focus)
  - frozen panels (default: stay; or removed)
  - app presence (default: Dock)

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
- Limiting the libraries custom views can load to a predefined set.
- Routing one channel to several panels.
- Ordering simultaneous pipes by the data's own timestamps.
- Smart outputs feeding other panels, and per-panel caps. Ad-hoc smart prompts are out entirely.
- Loading graph neighbors on demand.

## Open questions

1. **Daily cap:** does it reset at local midnight, or count a rolling 24 hours? Proposed behavior when hit: smart runs stop, the affected panels show "cap reached", and the agent sees it in its next tool result.
2. **Status display:** should panel title bars show state (live, idle, frozen) and smart status (running, cap reached), and should the window show today's token use against the cap?
3. **Evals:** which models? Proposed: Claude (Opus, Sonnet, Haiku), GPT and Gemini running the use cases above with synthetic data, possibly plus a small local model.
4. **Default config location:** used when `TAPET_CONFIG` isn't set. `~/.tapet/config.json` would fit tapet's home.

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
// → { pipe: "~/.npm/_npx/…/.bin/tapet -c 127.0.0.1:53211/ch_a1…", errors: [] }
```

The agent then runs the pipe from its own shell (and keeps it from blocking itself):

```bash
tail -f app.log | ~/.npm/_npx/…/.bin/tapet -c 127.0.0.1:53211/ch_a1…
```

Later calls such as `panel_update({ id: "api-log", smart: { … } })` change only the smart settings; the log's data and pipe are untouched. `smart_read({ panel: "api-log", last: 3 })` returns the three latest summaries.
