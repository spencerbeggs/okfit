---
"@okfit/engine": minor
---

## Features

- `validate --target 0.3` and its `--fix` cover root-relative links in every Markdown file of the bundle (index files, `log.md`, typeless and frontmatter-less files), not only concepts.
- `--fix` holds the version change back, with one refusal per cause, while a reference still resolves only from the bundle root, while an Attested Computation would lose its computation, or while a Markdown file cannot be read.
- A malformed config error names the failing key and the reason, for example `malformed config <path>: lint.missing_index: Expected ...`.
- New export `readMarkdownSources` and its `MarkdownSources` type. `migrationFindings` takes an optional list of extra sources to scan for root-relative links.

## Bug Fixes

- `computation-locator` no longer requires `runtime`, and judges a CRLF Computation section the same as its LF twin.
