# Chromatic Map: how to revert to the shared-codebook analysis

The Chromatic Map's analysis was changed so each photo is described by its
own colours rather than 64 colours shared by the whole gallery:

- Each photo is clustered on its own (20 colours), with near shades merged.
- Photos are compared directly on those colours (same Earth Mover's distance).
- Palettes are distinct colours plus up to 2 small, colourful accents.
- The Colours view gives every palette colour a visible arc.

To go back to the old version, run this from the repo root:

```sh
git apply -R _templates/chromatic-v1/revert.patch
cp _templates/chromatic-v1/chromatic-analysis.json assets/data/chromatic-analysis.json
```

The patch restores:

- `scripts/chromatic_analysis.py` (back to the shared-codebook script)
- `_includes/chromatic-geography.html` (the "How is this done?" maths text)
- `assets/js/_main.js` and `assets/js/main.min.js` (the ring's minimum arc)

The JSON is the old script's output for the gallery as it stood when the
change was made (52 photos). If photos have changed since, push the reverted
script and the GitHub workflow will regenerate the JSON; or run
`python scripts/chromatic_analysis.py` yourself.

`git apply -R --check _templates/chromatic-v1/revert.patch` says whether
the patch still applies, if those files have been edited since. Once you've
decided, delete this folder.
