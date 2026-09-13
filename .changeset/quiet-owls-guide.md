---
"@okfit/claude-code-plugin": minor
---

## Features

* The session-start orientation hook now renders each type's constraints (required keys, whether `verified` is required, declared fields with their enum values or `path` kind) alongside its description and guidance, matching the CLI's `okfit context` output.

## Bug Fixes

* `okf-context`'s CLAUDE.md-to-`index.md` pointer check now recognizes Claude Code's `@` import form and relative `./okf/...` links, not just backtick-quoted paths — a router written with `@` pointers was previously undercounted (3 of 41 found).
* The `okf-docs` agent is granted `SendMessage`, restoring its ability to report back to the dispatching agent.
* `okf-authoring` gains a rule on quoting YAML scalars that contain a colon followed by a space (`node:`, `workspace:`, `catalog:`, and similar protocol-style values previously broke frontmatter parsing) and clarifies that a concept's `stale_after` is always an absolute timestamp, never the config's `90d` duration shorthand.
