---
"@okfit/engine": minor
---

## Features

### `source-resource-missing` now ranges at the offending value

`lintResources`'s `source-resource-missing` diagnostic now ranges at the specific `resource` value that couldn't be resolved — the top-level `resource` field or the relevant `sources[i].resource` entry — instead of carrying no range, using `@okfit/core`'s new `DiagnosticRange.forFrontmatterPath`.

### New `conceptFor` export

```ts
import { conceptFor } from "@okfit/engine";

const concept = conceptFor(bundle, absolutePath);
```

Looks up the loaded concept at an absolute path already known to sit under `bundle.root`, returning `Option.none()` for a path outside the bundle, a reserved file, a non-markdown file, or one that never decoded into a concept. This is the same lookup `withFallbackRange` already used internally; it's now available to consumers that need to resolve an editor-reported path (a file URI, a hover position) back to its concept, such as `@okfit/lsp`.
