---
"@okfit/core": patch
---

## Bug Fixes

* A source's `usage_window` is decoded key by key, so a good `from` beside a bad `to` is kept and only the bad key is reported (#461)
* `broken-links` now checks the `#heading` of a path field (`superseded_by`, `resource`, `sources[].resource`, `computation`, `executor.resource`, `attester.resource`) against its target concept, as it does for a body link (#463)
* `generated-missing` now fires for a `generated` written without a readable `generated.by` (`generated: {}`, no `by`, a non-mapping) and for a concept with only a legacy `timestamp`, each with a message that says to set `generated.by` by hand, because `okfit sync` cannot fill either in (#466)
* `generated-missing` no longer promises that `okfit sync` will create the block for a `generated` written as `""`, `[]`, `!!null` or `&a ~`, or in a flow-style frontmatter block, or as an explicit `? generated` key: those get the hand-edit message (#466)
* A diagnostic for a bare `key:` or a tagged empty value (`generated: !!null`) now points at the key's own line instead of the first line of the frontmatter; `DiagnosticRange.forFrontmatterPath` still returns only a value's own text
* An unquoted root `okf_version` such as `0.10` is read as written (0.10, current) instead of as YAML's number 0.1, which kept the v0.2 fallbacks; unquoted text that is not a `<major>.<minor>` pair (`.2`, `1e1`) declares that text and reads as current; the warning shows the written value and says to quote it (#467)
* The `broken-links` and `generated-missing` descriptions in the config JSON Schema now say what they report

## Features

* New `DiagnosticRange.forFrontmatterKey(document, path)`, the range of a written mapping key, for an edit whose value has no text of its own (#467)
* New `Concept.isAbsent(value)`, the OKF 0.3 rule that `undefined`, `null`, an empty string and an empty list read as absent (#466)
