---
"@okfit/core": minor
---

## Features

### Two new lint codes

* `status-missing` (`lint.status_missing`, default `"off"`) reports a concept that carries neither `status` nor a `verified` entry, since the spec reads an absent `status` as `stable` and that silently hides an unfinished concept.
* `source-resource-missing` (`lint.source_resource_missing`, default `"warn"`) reports a `resource` or `sources[].resource` value that does not resolve to a file, either in the bundle or on disk relative to the concept.

### `broken-links` checks link fragments

A link like `[Foo](./bar.md#section)` is now flagged when `bar.md` exists but has no `#section` heading, not only when the target file itself is missing.

## Bug Fixes

* `footnote-undefined` and `footnote-source-unknown` no longer misreport a footnote-shaped token (`[^1]`) that appears inside an inline code span or a fenced code block as an actual footnote reference.
* Generated `index.md` entries now backslash-escape markdown-active characters (`` \ < > * _ ` [ ] ``) in a concept's title and description, so text containing them renders as literal characters instead of being interpreted as emphasis or inline HTML.
