---
"@okfit/core": minor
---

## Features

### Lint and profile diagnostics now range at the offending value

`Diagnostic.range` and `ProfileDiagnostic.range` used to anchor at the whole frontmatter block. They now anchor at the specific value a rule is complaining about — the `type` value for `unknown-type`, the `stale_after` value for `stale`, the offending value for `field-value-unknown`, and so on — falling back to the frontmatter block only when a rule has no more precise path (an absent key, or a bundle-level check with no concept to point at). A quoted scalar's range includes its delimiting quotes, since the underlying YAML parse reports it that way.

The new entry point is a public static:

```ts
import { DiagnosticRange } from "@okfit/core";

const range = DiagnosticRange.forFrontmatterPath(document, ["generated", "at"]);
```

It returns `undefined` when the document has no frontmatter block at all, and falls back to the whole-block range when the named path can't be found. `@okfit/profiles` and `@okfit/engine` both consume it to range their own diagnostics; see their changesets.
