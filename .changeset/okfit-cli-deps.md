---
"@okfit/cli": patch
---

## Bug Fixes

* Moved to `effect` 4.0.0-rc.118 import paths (the `effect/unstable/*` entry points were removed), fixing a startup failure when a consumer forces `effect` rc.118, for example in pre-commit hooks
* Kept the `sync` date flag's pattern in generated JSON Schema on rc.118
* Declared the `@effected/*` peers that `@okfit/core` and `@okfit/profiles` require, so installs no longer satisfy them from whatever version sits at the consumer root

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effected/cli | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/config-file | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/engine | dependency | updated | ^0.1.0 | ^0.2.0 |
| @effected/git | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/glob | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/jsonc | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/markdown | dependency | updated | ^0.12.1 | ^0.14.0 |
| @effected/schemastore | dependency | added | — | ^0.16.0 |
| @effected/toml | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/walker | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/yaml | dependency | updated | ^0.17.0 | ^0.18.0 |
| effect | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
