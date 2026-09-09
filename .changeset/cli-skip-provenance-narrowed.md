---
"@okfit/cli": minor
---

## Breaking Changes

- `okfit validate --skip-provenance` no longer silences the
  `generated-at-drift` lint entirely (issue #19). It now skips only the
  git-derived fallback check — the one used for a concept with no
  recorded `generated.body_sha256`. A bundle that has run `okfit sync`
  since this field was introduced still gets checked with the flag set:
  the comparison is over text already in memory, so it spawns no git
  process and still reports a body edited without a re-stamp. Anyone
  scripting around `--skip-provenance` to fully suppress
  `generated-at-drift` for a migrated bundle will start seeing that
  diagnostic again.
