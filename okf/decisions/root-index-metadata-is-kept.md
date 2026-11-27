---
type: Decision
title: The root index's metadata is read and kept
description: Core reads title, description, license, okf_version and extension keys from the bundle-root index.md (OKF v0.3 §8.1), and sync re-emits the existing frontmatter bytes instead of rewriting the block.
tags:
  - architecture
sources:
  - resource: ../../packages/core/src/internal/reserved.ts
    title: parseIndex reads the metadata and reports index-metadata-invalid.
  - resource: ../../packages/core/src/internal/templates.ts
    title: indexDocument re-emits the kept block.
  - resource: ../../packages/engine/src/sync/index.ts
    title: syncIndex passes the kept block to the renderer.
generated:
  by: okfit/claude-code
  at: 2026-11-27T22:02:01Z
status: stable
x-okfit-integrity:
  generated:
    body: 57bb747476215945
  verified:
    by: human:spencer
    at: 2026-11-24T02:55:14Z
    content: f00587574e4dbfbc
verified:
  - by: human:spencer
    at: 2026-11-23T22:18:50Z
  - by: human:spencer
    at: 2026-11-24T02:55:14Z
---

# The root index's metadata is read and kept

## Context

OKF v0.2 allowed the root `index.md` frontmatter to hold only `okf_version`;
anything else was the conformance error `index-frontmatter`. OKF v0.3 §8.1
lets the root index carry `title`, `description`, `license` and extension
keys as well. `okfit sync` regenerated the root index from scratch with
only `okf_version`, so reading the new keys while `sync` stripped them
would have deleted an author's metadata on the next run.

## Decision

`IndexDocument` gains `title`, `description` and `license` (typed reads),
`metadata` (the whole decoded mapping, extension keys included) and
`frontmatter` (the raw YAML text between the fences). They are set only on
the bundle-root index. `okfVersion` is the declared version as written.

Reading is tolerant. A non-string `title`, `description` or `license`, or an
`okf_version` that is not a quoted `<major>.<minor>` string, is reported as
`index-metadata-invalid` (lint, `warn`) and read best effort: an unquoted
number such as `0.3` still becomes the version `"0.3"`, read by its source
text, so `0.10` becomes `"0.10"`, not `"0.1"`, and text that is not a
`<major>.<minor>` pair, such as `1e1`, is kept as written. An empty block is
no metadata. The conformance error `index-frontmatter` remains for a root
block that is not a mapping, and for any `index.md` below the root that
carries frontmatter.

`Derive.renderIndex` takes the kept block as `frontmatter` and re-emits it
byte for byte. It adds `okf_version` only when the block declares none, and
never rewrites a declared version: raising a bundle's version is a
migration step, not a side effect of `sync`. Without a kept block it writes
a fresh block from `metadata` (`okf_version`, then `title` and `description`
when given), serialized through the YAML writer so a value that needs quoting
is quoted; a kept block is never merged with `metadata`. `syncIndex` passes the root index's
`frontmatter` to the renderer, so `sync` keeps whatever the author wrote. It
adds a version only when the caller passes one, and `runSync` passes the
config's `okf_version` only when the config sets it, so an undeclared root
stays undeclared.

## Alternatives rejected

Re-serializing the parsed mapping would reorder keys, drop comments and
change quoting on every sync, producing noisy diffs. Keeping the old
strict check and accepting that `sync` strips new keys would have made
okfit the one tool in the chain that could not hold a v0.3 root index.
Moving the `sync` call site to a later release would have let a version of
okfit accept metadata it then deleted.

## Consequences

A v0.3 root index survives `sync` unchanged apart from regenerated
sections. `init` writes `okf_version`, a `title` that is the project
directory name and a fixed `description`, so a new bundle starts with
metadata the author can then edit. The config's `okf_version` fills a root
index that declares none only when the config sets it; there is no default,
so `sync` never invents a declaration. A root `index.md` that is a symlink out
of the bundle is not read or written by `sync` at all (see [Markdown that is
not a concept is skipped](non-concept-markdown-is-skipped.md)).
