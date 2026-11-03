# Sessions

Your first `window_update` creates a tapet session with its own window and returns its id, e.g. `s_8f3k2…`. **Record the id.**

## When your connection closes

Harnesses close MCP connections routinely: a restart, or a conversation that goes idle while the user works elsewhere. So a closed connection doesn't end your session; it only detaches it.

- A detached session keeps running: pipes keep flowing and panels keep updating. The window says "No agent attached".
- Smart runs continue while the window is open, and pause while it's closed, since nobody can see them. The next run covers what arrived meanwhile.
- To take control again, call `session_attach({ session: "<id>" })`. It fails while another live connection holds the session.

## Idle timeout

A detached session ends after `idle_timeout` with no agent attached and no pipe open, an hour by default. A pipe that stays open, like `tail -f`, keeps it alive however long it runs. Choose the timeout with `window_update`, by how long your feeders may pause:

- `window_update({ idle_timeout: { seconds: 600 } })` for a quick look;
- `window_update({ idle_timeout: "never" })` for a dashboard that must keep running. It then ends only on `session_end`, when the user discards it, or when tapet quits.

## Resuming is your job

tapet doesn't save your setup. Keep your own record of what you created (`window_get` returns the window settings, CSS and every panel's settings) and of the commands that fed each panel, so you can recreate them.

## Ending

`session_end` ends the session at once, as the idle timeout does: its panels stay visible but stop updating, their title-bar dots and the window show it, and its pipes are closed. A pipe command into an ended session exits with code 75; `session_attach` brings the session back, and the same pipe commands then work again. If the user's config sets `ended_panels` to `remove`, an ending session's window closes instead, and the session can't be reattached. Your next `window_update` after `session_end` starts a new session with a new window.

## Closed windows

The user can close your window. A live session keeps receiving data, and your next window or panel call (`window_update`, `window_focus`, `panel_create`, `panel_update`, `panel_remove`) reopens it. Data never reopens it. `window_screenshot` and `window_inspect` need an open window; call `window_focus` first.

Closing the window of a session no agent holds, detached or ended, asks the user to discard or keep it. Discarding ends it for good; keeping a detached session runs it in the background until its idle timeout.

If the user quits tapet, every session is gone. Your next `window_update` starts tapet again with a new session.
