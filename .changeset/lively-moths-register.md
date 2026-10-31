---
"@okfit/mcp": minor
---

## Breaking Changes

* Tools and resources are now registered through `McpStdio.layer({ registrations })`, built before the first request (build logs go to stderr). Tools no longer declare `dependencies`. Wire behaviour is unchanged.
* `PlatformServices` now includes `Digest.Digest`, so hosts must provide a digest layer (for example `NodeCrypto.layerDigest` from `@effect/platform-node`).
* `ServerLayer` now outputs `McpServer | McpRequest<"Requires", Scope>` instead of `never`.

## Features

* New exported type `ToolServices` describing the services tools require.
