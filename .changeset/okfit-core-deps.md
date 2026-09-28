---
"@okfit/core": patch
---

## Bug Fixes

* Kept the `pattern` constraints for actors, timestamps, generated sha256 values and the config `stale-after` field in generated JSON Schema, which `effect` rc.118 would otherwise drop

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/glob | peerDependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/jsonc | peerDependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/markdown | peerDependency | updated | ^0.12.0 | ^0.14.0 |
| @effected/schemastore | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/toml | peerDependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/walker | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/yaml | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| effect | peerDependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
