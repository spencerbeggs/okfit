---
"@okfit/cli": minor
---

## Breaking Changes

* The exported `line` and `human` renderers take `{ paint: SeverityPaint }` instead of `{ color: boolean }`. `SeverityPaint` is a new exported type; callers that passed `color` must supply a paint function per severity instead

## Features

### Interactive verify picker

* A bare `okfit verify` in a terminal opens an interactive picker: choose concepts by type, review a confirm step with a promote-drafts toggle, and the selection is written in one all-or-nothing pass
* Esc, `q`, Ctrl-C or answering no exits 130 with nothing written
* Without a terminal, a bare `okfit verify` exits 64 with the hint "(run in a terminal to pick interactively)"

### Interactive init

* `okfit init` prompts for the profile, the bundle directory and the config location when run in a terminal
* New flags `--bundle <dir>` and `--config-location <.config/okfit.toml|okfit.toml|.okfit.toml>` answer those prompts up front; `InitBundleDirError` is exported for an invalid bundle directory

### Audience flags

* New global flags `--audience <human|agent|ci>`, `--human`, `--agent` and `--ci` choose who the output is for, and `OKFIT_AUDIENCE` sets it from the environment
* Passing more than one of them exits 64; an audience never refuses a command

### Colour

* Colour now follows Node's precedence: `FORCE_COLOR` beats `NO_COLOR`
* The interactive screens use `ink` and `react`, loaded only when a screen mounts, so non-interactive commands do not pay for them
