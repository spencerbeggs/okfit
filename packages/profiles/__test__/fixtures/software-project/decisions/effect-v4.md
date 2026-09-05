---
type: Decision
title: Effect v4 only
description: The kit targets Effect v4 at the catalog version and nothing older.
status: stable
verified:
  by: human:spencer
  at: 2026-09-05T00:00:00Z
tags: [architecture]
---

# Effect v4 only

Every package imports `effect` at the `catalog:effect` version. Effect v3 APIs are never used; the vendored source under `.repos/effect` is the reference.

## Alternatives rejected

- Supporting both v3 and v4 through adapters: doubles the test matrix for no consumer.
