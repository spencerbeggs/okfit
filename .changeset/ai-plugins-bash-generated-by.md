---
"@okfit/ai-plugins": minor
---

## Features

* The PostToolUse hook now checks `Bash` writes into the bundle for `generated.by`, not only `Write` and `Edit`. Authoring writes (`>`, `>|`, `tee`, a `cp`/`install` destination) block like a `Write`; edit-like writes (`>>`, `tee -a`, `sed -i`/`perl -i`, a `mv` destination) warn like an `Edit`. Commands with no `.md` write target never spawn the CLI.

## Documentation

* The okf-finalize skill and okf-docs agent describe `okfit sync --staged` writing the commit's own `log.md` entry
