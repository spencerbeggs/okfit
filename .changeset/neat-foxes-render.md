---
"@okfit/engine": minor
---

## Features

* The context envelope's `types[]` entries now carry `required`, `require_verified`, and `fields` — the constraints `validate` enforces for that type — instead of just `name`, `description`, and `guidance`. New exported schemas `ContextField` and `ContextFieldValue` describe one declared field and its enum values.

## Bug Fixes

* `init` now scaffolds `log.md` with a `# Log` title via `Derive.renderLog` instead of a bare entry, so the file's first line is a heading and passes markdownlint's MD041 in a repo that lints the bundle.
