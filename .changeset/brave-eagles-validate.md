---
"@okfit/cli": minor
---

## Features

First usable release of `@okfit/cli`: the `okfit` command line for OKF v0.2 bundles, built on `@okfit/core` and `@okfit/profiles`.

```bash
pnpm add -D @okfit/cli
okfit validate
```

### `okfit validate`

Loads the config, loads the bundle, runs conformance and lint checks, runs the resolved profile's own checks, and renders every diagnostic — one line per diagnostic to stdout (`<file>:<line>:<col> <severity> <code> <message>`, or `(bundle)` for a bundle-level diagnostic), then a summary line to stderr. `--skip-provenance` skips the `generated-at-drift` lint's git tier for a single run without touching the project's `[lint]` table.

### `okfit init`

Scaffolds a fresh bundle — a thin `.config/okfit.toml`, the bundle's `index.md` files, a `project.md` stub, and an initial `log.md` entry — then self-validates the result and exits with `validate`'s own exit code. It never overwrites: if any target path already exists, nothing is written and the command exits `3`. `--profile <name>` picks which profile to scaffold.

### `okfit context`

Prints the resolved project root, bundle root, config path, profile, and vocabulary without loading the bundle — cheap enough to call on every session or every in-bundle write.

### `okfit verify`

Appends one attestation, `{ by: human:<id>, at: <now> }`, to a concept's `verified` list and writes the file back atomically. The actor is always your own resolved git identity; existing entries are never touched. `--at <iso>` records a different instant; `--dry-run` prints what would be written without touching the file. This is a human-run command — no agent, hook, or MCP tool ever invokes it.

### `okfit sync`

Regenerates every derived-content family in one command: `generated.at` per concept (computed from git history), `index.md` for every directory that holds a concept, and `log.md` (the root log, curated prose topped up by date). Runs all three modes in order unless narrowed with one or more `--only` flags; `--dry-run` computes every result and writes nothing.

### Exit codes and JSON envelopes

A consistent exit-code contract across every subcommand — `130` interrupted, `64` usage error, `3` infrastructure failure, `2` conformance errors, `1` lint or profile errors, `0` otherwise, higher always winning. `--format json` on `validate`, `context`, `verify`, and `sync` prints one machine-readable envelope per command (`JsonEnvelope`, `ContextEnvelope`, `VerifyEnvelope`, `SyncEnvelope`) to stdout, with warnings and summaries kept on stderr.

### Config discovery

With no `--config` flag, `okfit` walks upward from the project root checking `.okfit.toml`, `okfit.toml`, then `.config/okfit.toml` in each directory, then falls back to the XDG, OS-native, and system config tiers. `--config <file>` bypasses discovery entirely and is a hard failure if the path does not exist.
