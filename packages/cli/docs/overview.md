# tapet

tapet is a window you direct to show things to your user. Data doesn't pass through you: you run commands in your own shell and pipe their output straight into tapet panels, so large or endless data never enters your context.

## Typical flow

1. `window_update({ name: "api logs" })` opens your window and returns your session id. Record it.
2. `panel_create({ id: "api-log", title: "API log", preset: "log" })` returns a `pipe` command.
3. In your shell: `tail -f app.log | <pipe>`. That pipe never exits on its own, so run it in a way that doesn't block you.
4. Arrange panels with CSS (`window_update({ css })`, a panel's `css`), and check the result with `window_inspect` or `window_screenshot`.

## Topics

- `panels`: presets, settings, ids, titles, retention
- `formats`: how a stream becomes items, and what each item does
- `views`: what each view shows and how to configure it
- `css`: the window's structure, classes and theme variables
- `pipes`: pipe commands, buffering, malformed data, `channel_write`
- `sessions`: ids, reconnecting, ending, closed windows
- `troubleshooting`: setup, version mismatches, errors and logs
