---
"@okfit/core": patch
---

## Dependencies

Moves to `effect@4.0.0-rc.115`; the `effect` peer range and the `@effected/*` peer ranges advance with it.

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effected/config-file | peerDependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/glob | peerDependency | updated | ^0.5.0 | ^0.6.0 |
| @effected/jsonc | peerDependency | updated | ^0.9.0 | ^0.11.0 |
| @effected/markdown | peerDependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/toml | peerDependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/walker | peerDependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/yaml | peerDependency | updated | ^0.14.0 | ^0.15.0 |

## Refactoring

* `lifecycle.default_stale_after` decodes through `SchemaGetter.transformEffect` (renamed upstream from `transformOrFail` in rc.113); no behaviour change.

## Documentation

* `Schema.toJsonSchemaDocument(okfitConfigDocumentFields)` now leaves declared tables open unless you pass `{ onExcessProperty: "error" }` — Effect's default flipped in rc.113. Pass the option to get the closed-table document the config schema contract describes.
