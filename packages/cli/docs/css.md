# CSS

You arrange and style the window with real CSS. The user can't rearrange anything by hand.

## Structure

```
#tapet                                  the window's root
  section.tapet-panel[data-panel=<id>]  one per panel, in creation order
    header.tapet-title                  the panel's title bar
      span.tapet-dot[data-state]        live, idle or ended
      span.tapet-title-text             the title
      span.tapet-smart-status           the smart trait's status, when not idle
    div.tapet-smart-output              the latest smart output, as markdown
    div.tapet-body                      fills the rest of the panel
      div.tapet-view                    the view
```

The log view inside `.tapet-view` uses `.tapet-log-search` (the search box), `.tapet-log-lines` (the scrolling area) and `.tapet-log-line` (one line).

## Where CSS goes

- `window_update({ css })`: one global stylesheet. Use it for the layout.
- A panel's `css` (in `panel_create` or `panel_update`): applies only inside that panel, as if wrapped in `@scope ([data-panel="<id>"])`.

By default, panels are stacked vertically and share the window's height. Your CSS overrides that. For example:

```css
#tapet {
  display: grid;
  grid-template-columns: 2fr 1fr;
  grid-auto-rows: 1fr;
  gap: 8px;
}
[data-panel='api-log'] {
  grid-row: span 2;
}
```

Hide a title bar with `.tapet-title { display: none }` in that panel's `css`.

## Theme variables

The theme follows the user's light or dark mode. Use these variables to fit in, or override them:

`--tapet-bg`, `--tapet-fg`, `--tapet-muted`, `--tapet-border`, `--tapet-panel-bg`, `--tapet-accent`, `--tapet-font`, `--tapet-mono`.

## Checking your layout

- `window_inspect` returns each panel's box, and flags panels that overflow or have zero size.
- `window_screenshot` shows what the user actually sees.
