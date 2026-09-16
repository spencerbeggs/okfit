---
"@okfit/core": minor
---

## Features

### The config JSON Schema contract, whole

Core now owns every part of the config file's JSON Schema, beside the `okfitConfigDocumentFields` struct that defines its shape:

- `CONFIG_SCHEMA_VERSION` (`"1.0"`), the schema's `major.minor` label.
- `okfitConfigSchemaHost`, the hosted identity, whose `versions` derive from that label; and `SCHEMA_DIRECTIVE`, the `#:schema` line a config file opens with. Both moved here from `@okfit/engine`.
- The schemastore build itself (`lib/configs/schemastore.config.ts`, `pnpm schema:build` / `schema:check`), which publishes the document to the repo's `schemas/` tree. The published document is unchanged.

`@effected/schemastore` is a new peer dependency.
