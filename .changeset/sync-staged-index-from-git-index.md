---
"@okfit/engine": patch
---

## Bug Fixes

`okfit sync --staged` in index mode now renders `index.md` from the git index instead of the working tree. An untracked concept, or one removed with `git rm --cached`, is no longer listed in the committed index, directories holding only untracked concepts are dropped, and a tracked concept with unstaged edits renders its indexed title and description (#142).
