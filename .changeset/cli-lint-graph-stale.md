---
"@okfit/engine": minor
---

## Features

* `okfit lint [path] [--config] [--format human|json] [--skip-provenance]` runs the same engine call as `okfit validate` but drops the conformance tier from what it collects and reports: exit `1` on a lint or profile error, `0` otherwise, never `2`, and its JSON envelope's `summary.conformance_errors` is always `0`.
* `okfit graph [path] [--config] [--format mermaid|dot|json]` renders the bundle's link graph — frontmatter path fields and body links, including dangling links — as a Mermaid flowchart (the default), GraphViz DOT, or a `GraphEnvelope` JSON document. Always exits `0`; loading never fails on content, so a bundle that fails `validate`'s conformance tier still graphs cleanly.
* `okfit stale [path] [--config] [--format human|json]` lists every concept whose `stale_after` instant has passed as of now (honouring `OKFIT_NOW`), sorted by id, each with how many whole days past it. A report, not a check: always exits `0`, printing a `StaleEnvelope` JSON document under `--format json`.
