---
type: Invariant
title: A config value is decoded exactly once
description: Every OkfitConfig in memory came through the codec, so downstream code never re-validates shape.
resource: ../../src/Config.ts
tags: [architecture]
---

# A config value is decoded exactly once

The `OkfitConfig` type is only constructible through `Schema.decodeUnknownSync`; the brand on the type means a hand-built literal does not type-check. A refactor that exports the raw struct would break this.
