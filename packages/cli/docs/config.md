# Config

tapet's config holds API keys, the models smart panels may use, and a few behaviors. It's the user's to write; tell them what to add.

## Where it is

Layers, lowest to highest; a setting in a higher layer replaces the same setting below it, and each provider counts as one setting:

1. Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (plus `OPENAI_BASE_URL`), `GOOGLE_GENERATIVE_AI_API_KEY`, and the `TAPET_*` names below.
2. The user's file: `TAPET_CONFIG` if set, otherwise `~/.config/tapet/config.json`, or `~/.config/tapet/config.env`.
3. The project's file: `.tapet/config.json`, or `.tapet/config.env`, in the folder the agent works in.

The config is read each time a session starts or is reattached. Files may be 1Password-mounted `.env` files. Keys in a project file are easy to commit by accident: keep them in the user's file, or add `.tapet/` to `.gitignore`.

## Settings

```json
{
  "providers": {
    "anthropic": { "api_key": "…" },
    "openai": { "api_key": "…", "base_url": "https://…/v1" },
    "google": { "api_key": "…" }
  },
  "models": ["anthropic/claude-haiku-4-5"],
  "default_model": "anthropic/claude-haiku-4-5",
  "smart_input_tokens": 50000,
  "window_focus": "never",
  "ended_panels": "keep",
  "daily_token_cap": 2000000,
  "app_presence": "dock"
}
```

- `models`: the models smart panels may use, as `"provider/model"`. Providers: `anthropic`, `openai`, `google`.
- `default_model`: used when a smart trait names none. Defaults to the first of `models`.
- `base_url` (OpenAI only): for proxies and local OpenAI-compatible servers. tapet then uses the chat completions API, and a key is optional.
- `smart_input_tokens`: a smart run's input budget (see `smart`).
- `window_focus`: `never` (the default), `open` (take focus when the window opens), or `update` (also on every window or panel change).
- `ended_panels`: `keep` (the default: an ended session's panels stay, frozen) or `remove` (its window closes and the session is discarded).
- `daily_token_cap` and `app_presence` (`dock` or `menu_bar`) apply to the whole app, so only the user's own layers set them, and the app reads them when it starts.

In a `.env` file, use the environment names above plus `TAPET_MODELS` (comma-separated), `TAPET_DEFAULT_MODEL`, `TAPET_SMART_INPUT_TOKENS`, `TAPET_WINDOW_FOCUS`, `TAPET_ENDED_PANELS`, `TAPET_DAILY_TOKEN_CAP` and `TAPET_APP_PRESENCE`.

Problems in the config come back with your next tool result; tapet ignores the broken settings and keeps the rest.
