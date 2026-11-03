---
name: add-example
description: Add an example to the tapet gallery site (site/) from a Claude Code session. Use when the user gives a session id and asks to add, create or publish a gallery example.
argument-hint: <session-id>
---

# Add a gallery example

The gallery lives in `site/`. Each example is a folder `site/examples/<slug>/` holding an `example.json` and its media. `node site/build.ts` renders the index and the example pages into `site/dist` (not committed; GitHub Actions builds and publishes it).

`example.json`:

```json
{
  "title": "Failing tests, live",
  "summary": "One or two sentences on what the user sees and why it helps.",
  "prompt": "the session's first prompt, verbatim",
  "date": "2026-11-03",
  "media": [
    { "src": "result.png", "alt": "what the image shows" },
    { "src": "demo.mp4", "alt": "what the video shows" }
  ]
}
```

An example page shows the summary, then the prompt, then the media in the listed order. The gallery card shows the first media item, or the one whose `src` is set as the optional `"thumbnail"`. `.mp4`, `.webm` and `.mov` are shown as video, anything else as an image.

## Steps

1. Read the session. Requires a session id argument; if there is none, ask for it.

   ```bash
   node site/session.ts <session-id>
   ```

   It prints `prompt` (the first prompt), `date` and `transcript` (the session's file).

2. Find out what the session showed. Read the `transcript` file for the tapet tool calls (`window_update`, `panel_create`, …) and the final result. Read only what you need; transcripts are long.

3. Draft a `title`, a kebab-case slug, and a `summary` of one or two plain sentences. Show them to the user with the prompt, and ask for changes. Keep the prompt verbatim; if it holds anything that looks private (names, paths, hosts, keys), point it out and let the user decide what to cut.

4. Ask the user for the images or videos to show, as file paths, and an alt text for each (offer a draft). At least one is required. If there are several, ask for their order on the page and which one the gallery card shows.

   Convert videos to MP4 for size and browser support, e.g. `ffmpeg -i in.mov -an -c:v libx264 -crf 32 -preset slow -pix_fmt yuv420p -r 30 -vf scale=1280:-2 -movflags +faststart out.mp4`. Aim for under ~10 MB, check a frame still looks sharp, and tell the user the size.

5. Create `site/examples/<slug>/`, copy the media into it with short lowercase names, and write `example.json`. Don't overwrite an existing example folder without asking.

6. Run `node site/build.ts`, open the page in the browser pane through the `site` server in `.claude/launch.json` (`http://localhost:8417/examples/<slug>/`; opening the files directly drops the styles and media) for the user to check, and fix what they ask for.

Don't commit; tell the user the example is ready to commit.
