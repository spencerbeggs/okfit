---
"@okfit/core": minor
---

## Breaking Changes

`OKF_SPEC_VERSION` is now `"0.3"`, and `OkfitConfig.DEFAULTS` no longer carries `okf_version`. The `okf_version` config key now only fills a root `index.md` that declares no version; a bundle's own declaration is never overwritten.

Required keys are judged more strictly: a required key written as null, an empty string or an empty list is reported by `required-key-missing` with the message "is empty". By the same alignment, `field-value-unknown` no longer fires on an empty value, and `generated-missing` now fires on `generated: ""` or `[]`. A single-mapping frontmatter family whose every key was dropped as malformed now reads as absent instead of an empty object.

`LintCode` gains the literals `resource-outside-project`, `superseded-by-orphan` and `superseded-by-unresolved`. A consumer that holds an exhaustive `Record<LintCode, ...>` or switches over every code must add them.

## Features

- Three new lint codes: `resource-outside-project` (default `info`), `superseded-by-orphan` and `superseded-by-unresolved` (default `warn`). The config schema document gains their keys (thirty-eight in all); the schema version stays `1.0`.
- New public API: `Graph.replacement`, `Derive.malformedStaleAfter` with the `MalformedStaleAfter` type, `RenderIndexOptions.metadata`, and `Bundle.parseDocument`, which returns a `Result` of `@effected/markdown`'s `MarkdownDocument` or `MarkdownParseError`.
- For a bundle that declares 0.3, a computation fence nested in a list item or block quote is found.
