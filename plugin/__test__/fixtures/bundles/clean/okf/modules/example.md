---
type: Module
title: Example Module
description: A tiny synthetic concept used only by this plugin's own tests.
resource: example.md
kind: plugin
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Example Module

Nothing here is read by production code; this bundle only gives the
plugin's BATS suites a real file tree to point a PATH-resolved `okfit`
smoke test at (§9.3), resolving on DEFAULTS.bundle.path/profile alone.

`resource: example.md` deliberately points at this file itself, rather than
at a real package or module — this synthetic bundle has no package root of
its own for a `Module` concept to point outward at.
