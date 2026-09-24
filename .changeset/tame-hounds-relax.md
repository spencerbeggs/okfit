---
"@okfit/engine": minor
---

## Features

* `FrontmatterEdits` — a public, `Context`-free facade over the `okfit verify` splice machinery: `.status(source, status)` and `.verified(source, entry)` return `MarkdownEdit`s at whole-file offsets into `source` as passed (BOM included), so a caller can apply them directly or map them to editor ranges without adjustment. `.verified` matches `okfit verify`'s own splice byte for byte
* `UnsupportedFrontmatterError` — raised instead of a partial write when a frontmatter shape `FrontmatterEdits` cannot splice safely
