# Sessions

Your first `window_update` creates a tapet session with its own window and returns its id, e.g. `s_8f3k2…`. **Record the id.**

## Reconnecting

When your MCP connection closes (your harness restarted, or you ended the conversation), the session ends: its panels stay visible but stop updating, and its pipes are closed. To continue, call `session_attach({ session: "<id>" })`. The session comes back to life; restart your pipes yourself.

`session_attach` fails if another live connection holds the session.

## Resuming is your job

tapet doesn't save your setup. Keep your own record of what you created (`window_get` returns the window settings, CSS and every panel's settings) and of the commands that fed each panel, so you can recreate them.

## Ending

`session_end` ends the session the same way a closed connection does. Your next `window_update` starts a new session with a new window.

## Closed windows

The user can close your window. A live session keeps receiving data, and your next window or panel call (`window_update`, `window_focus`, `panel_create`, `panel_update`, `panel_remove`) reopens it. Data never reopens it. `window_screenshot` and `window_inspect` need an open window; call `window_focus` first.

If the user quits tapet, every session is gone. Your next `window_update` starts tapet again with a new session.
