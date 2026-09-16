---
"@okfit/engine": minor
---

## Features

### Version metadata on every JSON envelope

- Exports `ENGINE_VERSION`, now stamped as `engine_version` on every JSON envelope (`JsonEnvelope`, `JsonErrorEnvelope`, and the graph/stale/sync/verify envelopes) — the value to compare across reports produced by different front ends.
- Exports `Distribution` and `DistributionField`: every envelope also carries `distribution`, `{ name, version }` for the meta-package a bin was installed through (e.g. `@okfit/plugin`), or `null` for a direct install.
- `ContextEnvelope` gains `config_schema_version`, sourced from `@okfit/core`'s `CONFIG_SCHEMA_VERSION`.

## Breaking Changes

`okfitConfigSchemaHost` and `SCHEMA_DIRECTIVE` are no longer exported; import them from `@okfit/core`, which now owns the config JSON Schema contract. The `schema:build` / `schema:check` scripts moved there too, and `@effected/schemastore` is no longer a dependency of this package.
