# Config

tapet's config holds API keys, the models smart panels may use, and a few behaviors. It's the user's to write; tell them what to add.

## Where it is

Layers, lowest to highest; a setting in a higher layer replaces the same setting below it, and each provider counts as one setting:

1. The standard key names: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (plus `OPENAI_BASE_URL`) and `GOOGLE_GENERATIVE_AI_API_KEY`, from the environment or from a `config.env` file (below).
2. The user's `~/.config/tapet/config.json`, or the file `TAPET_CONFIG` names.
3. The project's `.tapet/config.json`, in the folder the agent works in.

The config is read each time a session starts or is reattached.

## Secrets: `${NAME}` references

Any string in the JSON may reference a variable as `${NAME}`, so keys never have to sit in the JSON itself:

```json
{ "providers": { "anthropic": { "api_key": "${CLAUDE_API_KEY}" } } }
```

Variables come from the environment, then `~/.config/tapet/config.env`, then the project's `.tapet/config.env` (later ones win). A `config.env` file can be a 1Password-mounted `.env`. That also makes a project's `.tapet/config.json` safe to commit: it holds references, not keys.

- A reference works anywhere in a string, e.g. `"https://${HOST}/v1"`.
- `$${` stays a literal `${`.
- A reference with no value is reported, and the setting it's in is ignored.

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

Problems in the config come back with your next tool result; tapet ignores the broken settings and keeps the rest.
