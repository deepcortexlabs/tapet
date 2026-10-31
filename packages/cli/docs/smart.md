# Smart panels

Any panel can have a `smart` trait: an LLM that reads the panel's new data and keeps a rolling output. The output shows inside the panel, so the user sees it, and you can read it with `smart_read` without reading the data yourself.

```
panel_create({
  id: "api-log", title: "API log", preset: "log",
  smart: { prompt: "Summarize new errors and warnings. Update the previous summary.", every: { items: 10 }, history: 3 }
})
```

## Settings

- `prompt`: what the LLM should do with the panel's new data. Required.
- `every`: when to run on its own: `{ items: N }` after N new items, or `{ seconds: T }` every T seconds (skipped when nothing new arrived). Omit it to run only when you call `smart_run`.
- `history`: how many of its past outputs each run sees, so it can keep a rolling summary. Defaults to 1.
- `model`: `"provider/model"`, one of `models_get`'s list. Defaults to the config's `default_model`.

Change any of them with `panel_update({ id, smart: { … } })`. `smart: null` removes the trait.

## What a run sees

Each run gets your prompt, its last `history` outputs, and the items that arrived since its last successful run. In `upsert` and `patch` panels, updated items count as new.

The input has a token budget (`smart_input_tokens` in the config; tokens are estimated at about 4 characters each):

- When the waiting items would exceed it, the run starts early instead of waiting for `every`.
- If they still don't fit, as in a burst during a run, the oldest are summarized in chunks with the same model and those summaries stand in for them. At most 5 chunks are summarized per run; anything older is skipped, and the run is told how many items that was.

A trigger that fires while a run is in progress is skipped; the next run covers everything since the last one.

## Reading outputs

- `smart_run({ panel })` runs now, even with nothing new, waiting for a run in progress first, and returns the output.
- `smart_read({ panel, last })` returns the last N outputs (default 1), oldest first, each with its time, model, tokens and any error.

The panel's title bar shows the trait's status: running, cap reached, or error.

## Costs and limits

Smart runs use the user's API keys. A global daily token cap (`daily_token_cap`, 2 million by default) stops all smart runs until local midnight once it's reached; runs already in flight may go slightly over. Errors, such as a missing key or an unknown model, become the run's output and are also mentioned in your next tool result.

If `models_get` returns no models, the user needs to configure them (see `config`).
