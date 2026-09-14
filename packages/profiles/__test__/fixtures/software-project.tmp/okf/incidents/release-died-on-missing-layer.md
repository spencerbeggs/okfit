---
type: Incident
title: The 0.3.0 release died on an unprovided service
description: The CLI shipped with a layer built but never merged into the runtime, so every command failed at startup for one day.
occurred: 2026-09-02
guard: ../../vitest.config.ts
tags: [release]
---

# The 0.3.0 release died on an unprovided service

Consumers saw `Service not found: GitHistory` on every command. Root cause: the layer was constructed in a module nobody imported. The guard is an e2e test that runs each command against the built artifact.
