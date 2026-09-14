---
"@okfit/engine": minor
---

## Features

`validate` now checks that every `resource` and `sources[].resource` value on a concept resolves to a real file, either relative to the concept's own directory or to the bundle root. URLs, scope descriptions, and glob patterns are recognized as descriptors and skipped, never resolved against the filesystem. This check is controlled by `@okfit/core`'s new `source-resource-missing` lint code and reports nothing when that code is set to `"off"`.
