---
"@okfit/core": minor
---

## Breaking Changes

`[bundle] non_concepts` now rejects a glob whose `[` or `{` never closes. A config such as `non_concepts = ["[a-"]` that loaded before now fails to load. To match the character itself, write `'\['` in single quotes or `"\\["` in double quotes.

## Features

- New lint `computation-missing` (config key `[lint] computation_missing`, default `warn`). It fires on an Attested Computation that has no `computation` key and no computation under the bundle's declared reading.
- New lint `config-okf-version-stale` (config key `[lint] config_okf_version_stale`, default `warn`). It fires when the config sets `okf_version` and the bundle-root `index.md` declares a different one.
