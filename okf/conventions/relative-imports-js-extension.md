---
type: Convention
title: Relative imports use .js extensions
description: 'Relative imports end in .js; built-ins use the node: prefix; type-only imports are separate import type statements.'
status: stable
generated:
  by: human:spencer
  at: 2026-09-06T10:47:04Z
stale_after: "2026-12-05T00:00:00Z"
---

# Relative imports use .js extensions

## Rule

A relative import specifier ends in `.js` even though the source file is
`.ts`; a built-in module import carries the `node:` prefix; a type-only
import is its own separate `import type` statement, never mixed into a
value import (root `CLAUDE.md:40`).

## Why

`NodeNext`/ESM module resolution requires the on-disk (emitted) extension
on a relative specifier, so a `.ts` file importing another `.ts` file still
writes `.js` — the extension of what `tsc` emits, not what it reads.
`node:` makes a built-in's origin unambiguous at the import site, matching
`@effected`'s own house style, which these packages depend on.

## Scope

Every relative import in every package's `src/`; a bare package specifier
(`effect`, `@effected/git`, …) is unaffected — this rule governs relative
and built-in specifiers only.

## Where stated

Root `CLAUDE.md:40`; `packages/profiles/CLAUDE.md:32` (`.js` extensions,
`node:` built-ins, separate `import type` statements); `packages/cli/CLAUDE.md:110-111`
(same three parts, plus TSDoc `@public` and tab indentation stated
alongside it).
