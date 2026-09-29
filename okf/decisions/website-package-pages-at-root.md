---
type: Decision
title: User docs live under /docs; package hierarchies live at the site root beside their generated API
description: The okfit site serves user-facing docs under /docs and a technical page hierarchy per package at /<pkg>, next to that package's generated /<pkg>/api, rather than nesting packages under /docs or using one flat tree.
status: draft
tags:
  - docs
  - architecture
sources:
  - id: owner-url-model
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-29T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-29T22:18:38Z
  body_sha256: 96fc4a302944f3c77662cea0b99cf7277948e861651ef611c433f77e390c05e0
verified:
  - by: human:spencer
    at: 2026-09-29T22:19:48Z
---

# User docs live under /docs; package hierarchies live at the site root beside their generated API

## Context

The [Website](../modules/website.md) serves two audiences. Most readers want
to learn okfit and use its tools, and rarely care which package implements
what. A smaller group wants a package's technical detail: its overview,
advanced usage and API reference. `rspress-plugin-api-extractor` generates
each package's API pages at `/<pkg>/api`, so the package's other pages had
to be placed in relation to that generated tree. The owner chose the URL
model on 2026-09-29[^owner-url-model].

## Decision

- `/docs/**` holds the user-facing hierarchy: an overview with a Quick
  Start, How It Works, guides, the tools and reference.
- Each of `cli`, `core`, `engine`, `lsp`, `mcp`, `plugin` and `profiles`
  gets a technical hierarchy at `/<pkg>` (Overview, Getting Started,
  Advanced, API Reference) beside its generated `/<pkg>/api`.
- The Claude Code plugin and the VS Code extension have no package
  hierarchy, so they are `/docs/claude-code-plugin` and
  `/docs/vscode-plugin`. `/docs/packages` indexes the seven package
  hierarchies for a reader who starts in `/docs`.

Package pages are technical, which is why they sit beside the API they
describe rather than inside the user docs. The owner's effected repository
site follows the same pattern.

## Alternatives rejected

- Packages nested under `/docs/packages/<pkg>` -- it would put technical
  package detail inside the reader-facing tree, and the generated
  `/<pkg>/api` would still land at the root, separating each package's
  hand-written pages from its API pages.
- One flat docs tree with no per-package hierarchy -- the package pages
  would be mixed in with user guides, and nothing would group a package's
  pages with its generated API.

## Consequences

The site root carries seven package directories next to `/docs`, and a
package's pages must not be written into `/docs`. A new package adds a
`/<pkg>` hierarchy, a `savvy.build.ts` `meta.localPaths` entry pointing at
`website/lib/models/<pkg>` and a row in `/docs/packages`. Cross-links
between `/docs` and `/<pkg>` are ordinary site links rather than nesting.

[^owner-url-model]: conversation with the repository owner
