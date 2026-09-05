---
"@okfit/cli": minor
---

## Features

### `okfit validate`

Loads config (`.config/okfit/config.toml`, `okfit.config.toml`, or an
explicit `--config <file>`, falling back to `$XDG_CONFIG_HOME/okfit/config.toml`
for personal defaults), loads the OKF bundle, runs conformance and lint
checks plus the resolved profile's own checks, and renders every diagnostic
either as human-readable lines (`--format human`, the default) or as one JSON
document (`--format json`). Exit code reflects the worst diagnostic found:
`2` for a conformance error, `1` for a lint or profile error, `0` otherwise;
`3` for an infrastructure failure such as a bad `--config` path or malformed
config.

### `okfit init`

Scaffolds a fresh OKF bundle for a chosen profile (default `software-project`):
a thin config override, the bundle's root and per-directory index files, a
project stub, and an initial log entry — then self-validates the result and
exits with `validate`'s own exit code. Refuses to overwrite any existing
target path; nothing is written if any conflict is found.

## Dependencies

`@okfit/cli` now depends directly on the full runtime closure its own
command wiring and its dependencies' peers need: twelve more `@effected/*`
packages join the four dependencies the skeleton shipped with, and
`@effect/vitest` joins the dev toolchain.

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @effected/app | dependency | added | — | catalog:effected |
| @effected/cli | dependency | added | — | catalog:effected |
| @effected/config-file | dependency | added | — | catalog:effected |
| @effected/git | dependency | added | — | catalog:effected |
| @effected/glob | dependency | added | — | catalog:effected |
| @effected/jsonc | dependency | added | — | catalog:effected |
| @effected/markdown | dependency | added | — | catalog:effected |
| @effected/store | dependency | added | — | catalog:effected |
| @effected/toml | dependency | added | — | catalog:effected |
| @effected/walker | dependency | added | — | catalog:effected |
| @effected/xdg | dependency | added | — | catalog:effected |
| @effected/yaml | dependency | added | — | catalog:effected |
| @effect/vitest | devDependency | added | — | catalog:effect |
