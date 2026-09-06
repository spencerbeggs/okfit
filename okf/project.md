---
type: Project
title: okfit
description: Node.js tooling for the Open Knowledge Format (OKF) v0.2, published under the @okfit npm scope.
tags:
  - architecture
generated:
  by: human:spencer
---

# okfit

## Purpose

okfit is Node.js tooling for the Open Knowledge Format (OKF) v0.2, built on
Effect, published under the `@okfit` npm scope (`README.md:1-3`). OKF itself
is a directory of markdown files with YAML frontmatter that captures what a
project is and should be, with provenance, trust, and lifecycle as
first-class fields (`README.md:5`). okfit has two roles: it is the successor
to the design-docs workflow for keeping a repository's knowledge base
current, and it is also a general OKF toolkit usable on any conformant
bundle, including Google's own data-catalog-style bundles (`CLAUDE.md:7-11`;
`docs/superpowers/specs/2026-09-04-okfit-monorepo-design.md:8-14`, spec
section 1).

## Boundaries

The bundle splits into five packages plus a Claude Code plugin, each with a
single owned concern (`README.md:9-15`, `CLAUDE.md:18-27`):

- `@okfit/core` -- spec-level schemas, bundle loading, the link graph, and
  validation. Core has no opinions of its own; opinions belong in
  `@okfit/profiles` or config, never in core (`CLAUDE.md:37-38`).
- `@okfit/profiles` -- named configuration profiles, starting with
  `software-project`.
- `@okfit/cli` -- the `okfit` command line.
- `@okfit/mcp` -- the `okfit-mcp` Model Context Protocol server.
- `@okfit/plugin` -- the one meta-package a consuming repository installs.
- `plugins/claude-code` -- the okfit Claude Code plugin: a private,
  release-only workspace package, tagged but never published to npm
  (`plugins/claude-code/CLAUDE.md:3-6`).

## Non-goals

Phase 1 deliberately excludes:

- Implementing the MCP server -- `@okfit/mcp` ships as a stub until phase 2.
- CLI commands beyond `validate` and `init` -- other commands wait for
  phase 2.
- Listing the Claude Code plugin in the `spencerbeggs/bot` marketplace
  (`plugins/claude-code/CLAUDE.md:6`) -- deferred until phase 1 is dogfooded,
  which is what this bundle is for.
- A GitHub Action -- later.
- A VS Code extension -- later.
- Executing or attesting computations -- `@okfit/core` only models the
  Attested Computation frontmatter; it never executes or attests one itself.
