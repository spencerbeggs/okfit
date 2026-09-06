---
type: Decision
title: The validate hook fires PostToolUse, not PreToolUse
description: The Claude Code plugin's validate hook fires on PostToolUse, not the spec's PreToolUse, because the CLI can only validate bytes that already exist on disk.
tags: [architecture]
generated: { by: human:spencer }
status: stable
---

# The validate hook fires PostToolUse, not PreToolUse

## Context

The design spec's plain text describes the plugin's validate hook as firing
on `PreToolUse`, blocking a conformance error before it lands; the shipped
hook fires on `PostToolUse` instead — a documented departure from that text,
not an oversight.

## Decision

`PreToolUse` fires before the file exists on disk, and the CLI has no
content-overlay surface to validate bytes that are not yet written, so
pre-write validation is not buildable without new core surface; the hook
instead runs after the write, calls the whole-bundle `okfit validate
<project_root> --format json` once, filters `diagnostics[]` down to the
edited file's bundle-relative path, and blocks (`decision: "block"`) only on
a `core.conformance` hit for that file, warning (`additionalContext`) on a
`core.lint`/`profile`-only hit
(`docs/superpowers/research/plugin/decisions.md:145-162`, ruling M-20).

## Alternatives rejected

Building a core-level "validate this in-memory text without writing it" API
would let a true `PreToolUse` hook work exactly as the spec's plain text
describes, but no such surface exists in phase 1 and building one was
explicitly out of scope for the plugin's own plan; blocking on any
diagnostic severity rather than only conformance would make the hook reject
a merely-stylistic lint warning the same way it rejects a structurally
broken concept.

## Consequences

Every `Write`/`Edit` this plan's authoring tasks make under `okf/` triggers
a full bundle re-validate after the fact, once the local plugin is loaded
via `pnpm claude`, rather than a block before the write happens; Task V3's
hook smoke test exercises exactly this path against one real concept write,
recording the `emit_block`/`emit_context`/`emit_noop` outcome.
