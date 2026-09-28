# Goo toggle (archived template)

The original liquid "metaball" pill switch, used for the research tabs and the
Chromatic Map's Images | Colours until it was replaced by `.switch`
(`_sass/layout/_switch.scss`). Jekyll ignores this folder (it starts with `_`
and isn't a collection), so nothing here is built or published.

The git tag `goo-toggle-original` marks the last commit where it was live.

## Files

- `_goo-toggle.scss`: styles (was `_sass/layout/_goo-toggle.scss`)
- `goo-toggle.js`: `initGooToggle()` plus its resize listener (was in `assets/js/_main.js`)
- `markup.html`: the toggle markup and the SVG filter it needs

## Restoring it

1. Move `_goo-toggle.scss` back to `_sass/layout/` and add `"layout/goo-toggle",`
   to the import list in `assets/css/main.scss`.
2. Paste `goo-toggle.js` back into `assets/js/_main.js` above the research tabs
   section, then change `initSwitch(` to `initGooToggle(` in
   `initResearchTabs()` and `initChromatic()`. Rebuild with `npm run build:js`.
3. Put the hidden `<svg>` from `markup.html` back into `_layouts/default.html`,
   right after `{% include masthead.html %}`. It has to stay in the persistent
   shell, outside `#page-content`, or Swup swaps break it.
4. Swap the `.switch` markup in `_pages/research.html` and
   `_includes/chromatic-geography.html` for the `.goo-toggle` markup in `markup.html`.
