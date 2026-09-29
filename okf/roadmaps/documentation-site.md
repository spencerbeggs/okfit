---
type: Roadmap
title: A documentation site at okfit.dev
description: "Five phases that take the RSPress site from a bootstrapped workspace to okfit.dev serving filled user docs, per-package pages and a generated API reference: bootstrap, hosting and deploy, user docs, package pages, polish."
status: draft
gate: "okfit.dev serves a filled /docs hierarchy, a Getting Started and Advanced page for each package, and every package's generated API reference, built and deployed by CI."
stale_after: 2026-12-28T00:00:00Z
tags:
  - docs
  - dx
sources:
  - id: owner-website-plan
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-29T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-29T22:18:38Z
  body_sha256: bb36e2e6dc54d5cc2060e546bff6d3c532903a0a1a73edb31f63a23976f13e0d
---

# A documentation site at okfit.dev

## Gate

The roadmap closes when `https://okfit.dev` serves a filled `/docs`
hierarchy, a Getting Started and an Advanced page for each of the seven
packages, and each package's generated API reference, all built and
deployed by CI rather than by hand. The site is the [Website](../modules/website.md)
module; the URL split is recorded in [User docs live under /docs; package
hierarchies live at the site root beside their generated
API](../decisions/website-package-pages-at-root.md). The scope was agreed
with the repository owner on 2026-09-29[^owner-website-plan].

## Phases

1. **Bootstrap.** The `website/` workspace member, its RSPress config and
   the API model hand-off from each package's build, the navigation, page
   stubs for the `/docs` hierarchy and the package sections, the root `dev`
   and `preview` scripts, and the OKF records for all of it. Done on the
   bootstrap branch, pending its merge. Remaining: the merge.
2. **Hosting and deploy.** Point the `okfit.dev` domain at a host, add a
   CI workflow that builds the site (packages' prod builds first) and
   deploys it, and produce a sitemap. Neither the host nor the workflow is
   chosen yet. Remaining: everything.
3. **User docs.** Write the `/docs` pages: the overview, which carries a
   Quick Start section in place of a separate getting-started page; How
   It Works, a bottom-up walkthrough of the layers (the Open Knowledge
   Format, which also presents the OKF specification itself; vocabulary:
   types and tags; profiles; provenance and trust; one engine, many tools; agents in the loop -- deliberately agent-generic,
   since the Claude Code plugin is expected to be one agent integration
   among several, each documented under the tools), named so it never
   collides with OKF's own term "concept"; guides (adopting okfit in a
   repository -- the detailed walkthrough the Quick Start points to,
   writing concepts, keeping a bundle current, customizing the
   vocabulary); the tools (Claude Code plugin, CLI -- which also carries
   CI usage -- VS Code extension, MCP server, language server); reference
   (config, diagnostics, the software-project profile, frontmatter
   fields); and the package index. All of them are stubs today.
   Remaining: everything.
4. **Package pages.** For each of `cli`, `core`, `engine`, `lsp`, `mcp`,
   `plugin` and `profiles`, write the Overview, Getting Started and
   Advanced pages beside the generated API Reference. Remaining:
   everything.
5. **Polish.** Logo, favicon and Open Graph image, theme, and the
   `llms.txt` view options in the outline. Remaining: everything.

The sibling goal is publishing the VS Code extension, tracked in [An
@okfit/lsp language server and a VS Code extension over the shared
engine](lsp-server-and-vscode-extension.md) and carried out by [Publish
the VS Code extension](../runbooks/publish-vscode-extension.md); the
`/docs/vscode-plugin` page should describe an install path that exists
only once that release ships, so phase 3 writes it last.

[^owner-website-plan]: conversation with the repository owner
