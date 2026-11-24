---
"@okfit/ai-plugins": minor
---

## Features

### Skills teach OKF v0.3

- `okf-spec` and `okf-authoring` are rewritten for OKF v0.3.
- `okf-config` documents all forty lint keys and `[bundle] non_concepts`.

### New `okf-upgrade` skill

`okf-upgrade` walks an agent through upgrading a bundle to OKF 0.3: run `okfit validate --target 0.3`, apply the safe fixes, and hand what remains to a human. It needs an `@okfit/cli` that supports `validate --target`, and the skill checks for the flag first.

### Hook blocks unlisted non-concept Markdown

The PostToolUse hook now stops an agent that writes a non-concept Markdown file the bundle does not list. A `Write` or shell write that creates one is blocked with a message saying how to fix it (add a frontmatter `type`, move the file out of the bundle, or ask a human to list it in `[bundle] non_concepts`). An `Edit` of such a file gets a warning. The hook does nothing when the bundle has no `non_concepts` list or the installed CLI predates the `non-concept-unlisted` lint.
