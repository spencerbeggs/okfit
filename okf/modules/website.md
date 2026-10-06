---
type: Module
title: Website
description: The okfit documentation site -- an RSPress 2 workspace member at website/ that serves user docs under /docs and a technical page hierarchy per package beside each package's generated API reference.
status: draft
resource: ../../website
kind: website
tags:
  - docs
  - dx
generated:
  by: okfit/claude-code
  at: 2026-10-06T04:20:11Z
  body_sha256: 47622a932f839e49f58be5b08264403f9442831ec1fb3347380d0e7eff41d94a
---

# Website

## Purpose

`website/` is the documentation site for okfit, planned for
`https://okfit.dev`. It is a private pnpm workspace member (package name
`docs`) built with RSPress 2 and `rspress-plugin-api-extractor`, whose
author is the repository owner. It is unpublished and unhosted for now: the
bootstrap branch lands the workspace, navigation and page stubs, and the
hosting and content work is queued in [Documentation
site](../roadmaps/documentation-site.md). It is neither an npm package nor
an agent or editor plugin; the [AI Plugins](ai-plugins.md)
and [VS Code Extension](vscode-extension.md) appear on the site as pages
under `/docs`, not as sites of their own.

## Layout

- `rspress.config.ts` -- the site config: `root: "content"`, `outDir:
  "dist"`, `llms: true` (with the LLM view options in the outline),
  `siteOrigin: "https://okfit.dev"`, `route.cleanUrls`, and
  `ApiExtractorPlugin` reading its models from `./lib/models` through
  `ApiExtractorPlugin.apis.fromDir`.
- `content/` -- the authored pages, `_nav.json` and `index.mdx` (the
  landing page). One directory per URL section, see URL model below.
- `lib/models/<pkg>/` -- API Extractor models handed over by each package's
  build (Build and model hand-off below). Generated, gitignored.
- `lib/scripts/dev.mts` and `lib/scripts/preview.mts` -- what the root
  `pnpm dev` and `pnpm preview` scripts run.
- `turbo.json` -- the `build`, `dev` and `preview` tasks, all uncached; each
  depends on the workspace's `^build:prod` so the models exist first.
- `dist/` -- the built site.

## Build and model hand-off

The API reference is generated, not written. Each publishable package's
`savvy.build.ts` sets `meta.localPaths` to
`../../website/lib/models/<pkg>`, so that package's `build:prod` copies its
`*.api.json`, `package.json`, `tsconfig.json` and `tsdoctor.json` into that
directory. `ApiExtractorPlugin` then turns the models under `lib/models`
into each package's `/<pkg>/api` pages at site build time. The seven
packages that hand over models are `cli`, `core`, `engine`, `lsp`, `mcp`,
`plugin` and `profiles`.

Because the models come from prod builds, the site's `build`, `dev` and
`preview` tasks depend on `^build:prod` and are never cached; an API change
in a package shows up in the site only after that package is rebuilt for
prod.

## URL model

- `/` -- the landing page.
- `/docs/**` -- the user-facing hierarchy, where most readers spend their
  time: an overview with a Quick Start, How It Works (a layer-by-layer
  walkthrough from OKF up to the tools), guides, the tools (Claude Code
  plugin, CLI, VS Code extension, MCP server, language server), reference
  and the package index. The Claude Code plugin and VS Code extension have no
  package hierarchy, so they live here as `/docs/claude-code-plugin` and
  `/docs/vscode-plugin`.
- `/<pkg>/**` for `cli`, `core`, `engine`, `lsp`, `mcp`, `plugin` and
  `profiles` -- a technical landing hierarchy per package (Overview,
  Getting Started, Advanced, API Reference) sitting next to that package's
  generated `/<pkg>/api`.

The split is recorded in [User docs live under /docs; package hierarchies
live at the site root beside their generated
API](../decisions/website-package-pages-at-root.md). The effected
repository's site uses the same pattern.

## Commands

```bash
pnpm dev        # turbo run dev --filter=docs: build:prod for the packages, then the RSPress dev server
pnpm preview    # turbo run preview --filter=docs: build, then serve the built site
pnpm --filter docs build   # a production site build into website/dist
```

## Gitignored

`lib/models/*` (the handed-over API models), `content/*/api/` (each
package's generated API pages) and `**/.api-docs/**` are ignored; never
edit or commit them. Regenerate them by rebuilding the package and the
site. Authored pages under `content/` are not ignored.

## Links

- [Workspace](workspace.md) -- the root, its scripts and the layout
  `website/` joins.
- [Core](core.md), [Profiles](profiles.md), [Engine](engine.md),
  [CLI](cli.md), [MCP](mcp.md), [LSP](lsp.md) and [Plugin](plugin.md) --
  the packages whose builds feed `lib/models/`.
- [AI Plugins](ai-plugins.md) and [VS Code
  Extension](vscode-extension.md) -- documented under `/docs`, not at the
  root.
- [User docs live under /docs; package hierarchies live at the site root
  beside their generated API](../decisions/website-package-pages-at-root.md)
- [Documentation site](../roadmaps/documentation-site.md)
