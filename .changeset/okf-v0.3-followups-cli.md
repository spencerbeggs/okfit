---
"@okfit/cli": minor
---

## Features

- Under `--format json`, a flag the parser rejects prints one JSON error envelope on stdout with `exit_code` 64. Help still goes to stderr, and stdout stays empty without `--format json`.
- `okfit validate --target 0.3 --fix` now covers root-relative links in every Markdown file of the bundle. It lists one refusal line per cause when it holds the version change back: a link that still resolves only from the bundle root, an Attested Computation that would lose its computation, or a Markdown file that cannot be read.
- A malformed config error names the failing key and the reason.
