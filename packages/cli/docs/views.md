# Views

Views available in this version: **log**. More are coming (table, chart, graph, map, document, gauge, custom).

## log

Shows each item as one line, in a monospace font without wrapping (scroll sideways for long lines).

- Accepts `format: "lines"` and `update: "append"`.
- Renders terminal colors (ANSI escape codes), so colored output from test runners and CLIs looks right.
- Has a search box that filters the panel to matching lines (case-insensitive) and shows how many match.
- Follows the newest line by default. When the user scrolls up, following pauses; a "Jump to latest" button resumes it. Set `follow: false` to turn it off.
- Use `retention: { last: <lines> }` for logs that never end.
