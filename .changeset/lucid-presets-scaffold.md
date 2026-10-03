---
"@okfit/profiles": minor
---

## Features

- Add `DocsPreset` and `SurfaceTemplate` types and a required `docsPresets` member on `Profile`. The `software-project` profile ships four presets of starter Surface concept templates: `npm-package`, `monorepo-router`, `monorepo-shared-docs`, and an additive `site` preset that swaps the README templates for one-page variants linking to the site.

## Breaking Changes

- `Profile` now requires `docsPresets: ReadonlyArray<DocsPreset>`. Custom `Profile` implementations must add it; an empty array is valid.
