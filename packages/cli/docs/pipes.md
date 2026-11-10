# Pipes

`panel_create` returns `pipe`: a ready-to-run command that streams its standard input into the panel. It includes the full path to tapet, so it works without a global install.

```
tail -f app.log | <pipe>
```

- Run the command yourself, in your own shell. Your harness's permissions apply as usual.
- `tail -f` and similar commands never exit, so run them in a way that doesn't block you (for example in the background), and under `run` (see Feeders).
- The pipe command prints nothing on success. On an error it prints the reason and the command that shows the session log, and exits with a non-zero code: 75 when the session has ended but an agent can resume it with `session_attach` (the same command then works again), and 1 otherwise.
- Many programs buffer their output when it goes to a pipe, so data arrives in bursts. Ask them for line buffering, e.g. `PYTHONUNBUFFERED=1`, `grep --line-buffered`, `stdbuf -oL <command>`.
- Several pipes can feed one panel, one after another or at the same time. Simultaneous items are ordered by when tapet received them.
- One command can feed several panels with `tee` and process substitution: `<command> | tee >(<pipe A>) >(<pipe B>) > /dev/null`. Pipe commands never change how the outputs they share behave, so the other readers lose nothing.
- `--ignore-malformed` skips malformed items instead of stopping (see `formats`).
- When your session ends, its pipes are closed. A command piped straight into one stops the next time it writes. A loop or script that runs pipe commands over and over doesn't: run it under `run`.

## Feeders

`window_update` (and `window_get`) returns `run`: a command prefix that runs a feeder for as long as your session is live. Start anything long-running that feeds your panels under it, in the background:

```
<run> bash -c 'tail -f app.log | <pipe>'
<run> ./feed.sh
```

- `run` takes a command and its arguments, not a shell line: wrap pipelines in `bash -c '…'`.
- When the session ends (`session_end`, the idle timeout), is discarded, or tapet quits, tapet stops the feeder and everything it started: SIGTERM to its process group, then SIGKILL after 5 seconds. When the feeder's own command exits, whatever it left running in the background is stopped too.
- `run` exits with the feeder's exit code when the feeder exits on its own. When tapet stops it, `run` exits with 75 if an agent can resume the session (start your feeders again after `session_attach`), and 1 otherwise. Against an ended session it exits with 75 without starting the feeder.
- A running feeder doesn't keep the session alive; only its pipes do (see `sessions`).
- Signals sent to `run` (Ctrl-C, `kill`) stop the feeder too. Only `kill -9` on `run` itself leaves the feeder running.

## channel_write

`channel_write({ panel, data })` sends data you already have, such as a summary you wrote or a few numbers. tapet processes it exactly like a pipe: the panel's format splits it into items. Use pipes for anything large or streaming.
