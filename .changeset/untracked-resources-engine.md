---
"@okfit/engine": minor
---

## Features

* `okfit validate` and the MCP `validate_bundle` now report a `resource` or `sources[].resource` that exists locally but is gitignored (`resource-ignored`, error) or not yet tracked by git (`resource-untracked`, warning; not raised once the file is staged). A directory is tracked when the index lists a file under it, a path inside a submodule is judged against the submodule's own index, and a bundle outside a git repository is skipped.
* `RunOptions` gains `skipUntracked`. `skipProvenance` implies it, and the language server's `BundleSession` always sets it.
