---
"@okfit/cli": minor
---

## Features

- `okfit stale --verify` re-attests stale concepts and rolls their `stale_after` forward; add `--dry-run` to preview.
- Interactive `okfit sync` now shows the plan and asks for confirmation before writing. Pass `--yes` to skip the prompt.
- Human-readable reports render through the `@effected/cli` Doc IR, with OSC 8 links to files. `validate` and `lint` also emit GitHub Actions annotations, with paths relative to `GITHUB_WORKSPACE`.
- Adds new render exports for the human reports.
- An interactive `okfit sync` refuses to write if a planned file changed while the confirm was open. It exits `3` and writes nothing; re-run sync.
