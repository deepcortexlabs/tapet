# Pipes

`panel_create` returns `pipe`: a ready-to-run command that streams its standard input into the panel. It includes the full path to tapet, so it works without a global install.

```
tail -f app.log | <pipe>
```

- Run the command yourself, in your own shell. Your harness's permissions apply as usual.
- `tail -f` and similar commands never exit, so run them in a way that doesn't block you (for example in the background).
- The pipe command prints nothing on success. On an error it prints the reason and the command that shows the session log, and exits with a non-zero code.
- Many programs buffer their output when it goes to a pipe, so data arrives in bursts. Ask them for line buffering, e.g. `PYTHONUNBUFFERED=1`, `grep --line-buffered`, `stdbuf -oL <command>`.
- Several pipes can feed one panel, one after another or at the same time. Simultaneous items are ordered by when tapet received them.
- `--ignore-malformed` skips malformed items instead of stopping (see `formats`).
- When your session ends, its pipes are closed. The commands feeding them stop the next time they write.

## channel_write

`channel_write({ panel, data })` sends data you already have, such as a summary you wrote or a few numbers. tapet processes it exactly like a pipe: the panel's format splits it into items. Use pipes for anything large or streaming.
