# Formats and updates

## format: how the stream is split into items

- `lines`: each line is an item (a string). Empty lines are kept.
- `ndjson`: each non-blank line is one JSON value.
- `csv`: RFC 4180 CSV. The first line is the header unless you set `header: false`. With a header, items are objects whose values stay strings; without one, items are arrays.
- `whole`: each pipe's entire input is one item (a document, an image).

Text is read as UTF-8. Both LF and CRLF line endings work.

## update: what each item does

- `append`: adds the item at the end.
- `replace`: the item replaces everything; the panel keeps only the latest item.
- `upsert`: the item replaces the one with the same `key` value, or is added if it's new. Every item needs the key field, graph edges included.
- `patch`: like `upsert`, but the item is merged into the existing one with JSON Merge Patch (RFC 7396): fields you send overwrite, `null` deletes a field, and nested objects merge.

In `upsert` and `patch`, an item with `"_deleted": true` removes its row or node. The marker itself is never stored.

## Malformed data

A line that isn't valid JSON, a CSV row with the wrong number of columns, or an item without its key field stops that pipe: the pipe command prints the error with the command that shows the session log, and your next tool result mentions it too. Items before the bad one are kept. Add `--ignore-malformed` to the pipe command to skip bad items instead.
