---
"@okfit/mcp": minor
---

## Breaking Changes

- `McpToolError` is now `@effected/mcp`'s `ToolRefusal`. The `ConfigError`, `BundleNotFound`, `ConceptNotFound`, `UnknownVocabulary` and `InvalidArgument` exports are removed; a failed call still reaches the client as `isError: true` with the same message text, but there is no per-failure tag to match on.

## Features

- The `okfit-mcp` bin installs its crash guards through `McpGuard.run` with an `exitBeforeConnect` policy: a stray exception before the server is serving exits `1`, and one after it is logged to stderr while the server keeps answering.

## Tests

- The suite pins both halves of the crash policy against the built bin, and negotiates protocol versions through `McpHarness.initializeWith`.
