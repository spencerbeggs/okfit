---
"@okfit/claude-code-plugin": minor
---

## Features

* The `PostToolUse` validate hook now reads the written file and, when the config sets `actors.agent`, blocks a `Write` of a concept whose frontmatter has no `generated.by` (and warns on an `Edit`), naming the exact `by:` value to add. `index.md` and `log.md` are exempt; a repo with `actors.agent` unset is never checked.
* The `okf-docs` agent is told to stamp `generated.by` before writing rather than after the block.
