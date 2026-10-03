---
"@okfit/claude-code-plugin": patch
---

## Bug Fixes

- Change `okf-authoring` rule 14 so authors always write `status` explicitly: `draft` when unreviewed, `stable` when settled, and always `draft` for a Decision. This agrees with the `status_missing` lint the `software-project` profile raises to `warn`, and the `okf-docs` agent follows the same rule.
