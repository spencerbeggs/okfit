---
"@okfit/claude-code-plugin": patch
---

## Bug Fixes

- Fix the stamp flow in `okf-finalize` and the `okf-docs` agent: after committing, run `okfit sync --dry-run` and make a stamp commit only if it reports writes, since a pre-commit hook running `okfit sync --staged` may already have stamped the concepts. The hook path never writes `log.md`, so the follow-up sync may write only `log.md`, which is committed alone.
