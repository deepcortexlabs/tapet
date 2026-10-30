# Panels

A panel is a channel (where data comes in), the data it keeps, and a view that shows it.

## Creating

```
panel_create({ id: "api-log", title: "API log", preset: "log", retention: { last: 50000 } })
```

- `id`: a simple name (letters, digits, `-` and `_`, starting with a letter, at most 64 characters). You use it in CSS as `[data-panel=api-log]`.
- `title`: required; shown in the panel's title bar.
- `preset`: a named bundle of settings. Any setting you also send overrides it.

| Preset       | format                    | update         | view     |
| ------------ | ------------------------- | -------------- | -------- |
| `log`        | lines                     | append         | log      |
| `timeseries` | ndjson                    | append         | chart    |
| `table`      | ndjson                    | append         | table    |
| `graph`      | ndjson                    | upsert by `id` | graph    |
| `document`   | whole                     | replace        | document |
| `gauge`      | lines                     | replace        | gauge    |
| `map`        | ndjson (GeoJSON features) | upsert by `id` | map      |

Without a preset, set `format`, `update` and `view` yourself. See `formats` and `views`.

## Settings

- `format`, `header`, `update`, `key`: decide how incoming data is read. **Fixed at creation**: to change them, `panel_remove` the panel and create a new one (with a new pipe).
- `retention`: what the panel keeps. `"all"` (the default), `{ last: <items> }` or `{ seconds: <seconds> }`. Memory is your responsibility: set retention on panels that receive endless data. It doesn't apply to `replace` panels, which keep only the latest item.
- `view`: how the data is shown.
- `follow`: keep the newest data in view. On by default for `append` panels whose view supports it.
- `mapping`: which data fields go where, per view. tapet never guesses.
- `css`: styles for this panel only (see `css`).

## Changing

`panel_update({ id, ...fields })` replaces the fields you send and keeps the rest. The panel's data and pipe stay untouched. tapet rejects contradictory settings and explains why, e.g. `upsert` without a `key`.
