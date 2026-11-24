---
"@okfit/core": minor
---

## Breaking Changes

okfit's integrity block moves under the OKF v0.3 producer prefix: the frontmatter key is now `x-okfit-integrity` (same shape: `generated.body`, `verified.{by,at,content}`). A concept that still carries a bare `integrity` block no longer decodes into `Concept.integrity`, so okfit does not see its recorded digests or verifications. `Concept.integrity` and the `Integrity` classes keep their names.

Run `okfit sync` once per bundle to rename the key in place. Until then, earlier verifications report as no longer current.

## Features

- New exports `INTEGRITY_KEY` (`"x-okfit-integrity"`) and `OKFIT_KEY_PREFIX` (`"x-okfit-"`), the single source for every reader and writer of okfit's keys.
- Lint rule descriptions name `x-okfit-integrity` and `x-okfit-renders` in place of the old spellings.
