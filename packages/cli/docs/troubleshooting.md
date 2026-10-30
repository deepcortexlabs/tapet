# Troubleshooting

## "tapet isn't set up yet"

tapet runs on its own copy of Electron. Run the setup command from the error message, then retry. It downloads about 100 MB and shows progress.

## "a different version of tapet is already running"

The running app speaks a different internal protocol than this tapet. Ask the user to quit tapet (Cmd-Q on macOS), then retry; tapet starts again on your next call.

## A pipe stopped

The pipe command printed why and the command that shows the session log. The usual causes are malformed data (see `formats`) and the session ending (see `sessions`).

## A panel failed to render

The error from `panel_create` or `panel_update` says why. Check that the view exists in this version (see `views`).

## The session log

Every error tells you how to read the log: `<tapet> logs --session <id>`. It lists tool calls, pipes opening and closing, malformed data and render errors.
