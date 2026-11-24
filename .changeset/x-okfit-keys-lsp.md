---
"@okfit/lsp": minor
---

## Breaking Changes

- The verify action reads the `x-okfit-integrity.verified` binding and refuses a concept that still carries the old `integrity` block, with a message to run `okfit sync`.
- Hover and completion show the `x-okfit-` prefixed profile fields.

Run `okfit sync` once per bundle; until then the old block is not seen and earlier verifications show as drifted.
