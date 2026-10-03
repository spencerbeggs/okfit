---
"@okfit/claude-code-plugin": minor
---

## Features

- Add five docs skills: `docs-detect-shape`, `docs-templates`, `docs-badges`, `docs-humanize` and `docs-render`, covering shape detection, README and docs-TOC templates, badge blocks, de-AI-ifying prose, and rendering pages from the OKF bundle.
- Add the `okf-publisher` agent, which publishes docs pages rendered from the OKF bundle and restamps them with `okfit sync --publication`.
- Narrow the `okf-docs` agent to writing inside `okf/` only; publishing pages outside the bundle now belongs to `okf-publisher`.

## Breaking Changes

- Remove the `npm-readme` skill. Its README template content now lives in `docs-templates` and its badge guidance in `docs-badges`; invoke those instead.
