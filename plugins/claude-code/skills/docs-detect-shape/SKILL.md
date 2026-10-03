---
name: docs-detect-shape
description: >-
  Detects a repo's shape and metadata (single package, monorepo root,
  sub-package, website, docs folder) and sets up its Surface concepts under
  okf/surfaces/. Use when starting docs work in a repo that has no Surface
  concepts yet, when asked "what shape is this repo", "which docs presets
  apply", "set up documentation surfaces", or before writing a README or docs
  page whose shape is unknown.
allowed-tools: Read, Glob, Grep, Write, Bash(okfit validate*), Bash(ls *), mcp__plugin_okfit_mcp__describe_vocabulary, mcp__plugin_okfit_mcp__list_concepts, mcp__plugin_okfit_mcp__get_concept, mcp__plugin_okfit_mcp__validate_bundle
---

# docs-detect-shape

Classify the repo, recommend a docs preset, and write the matching Surface concepts as drafts. Detection itself only reads; the write step comes after the user answers.

## 1. Detect

Read `package.json`, `pnpm-workspace.yaml` (or the `workspaces` field), and check whether `website/` and `docs/` exist. Resolve the target directory from the argument, else the working directory.

- **monorepo-root** needs at least one real sub-package: a `package.json` outside the root matched by `pnpm-workspace.yaml` `packages:` globs, `workspaces` globs, or `packages/`. A `workspaces` field alone is not enough.
- **A self-referential or empty workspace is not a monorepo.** `workspaces: ["."]`, or globs that match no `package.json` outside the root, make it a single-package repo using a one-element workspace for tooling. Combined with `private: true` and no `packages/` sub-packages, classify as `single-package`.
- **monorepo-sub-package**: the current `package.json` sits under a path the parent's workspace globs match.
- Otherwise **single-package**.
- Ignore a `docs/` that holds only `superpowers/`; it is not a docs folder.
- Metadata from `package.json`: `name`, `license` (SPDX), `engines` (node, bun, deno; treat `*`, empty or `>=0` as absent), the `typescript` floor version (strip `^`, `~`, `>=`), `packageManager` or lockfile. Never invent a value: report a missing one as null.

Report the result as a short YAML block (`kind`, `packageName`, `license`, `runtime`, `engineRange`, `tsVersion`, `hasWebsite`, `hasDocs`).

## 2. Recommend a preset

Call `mcp__plugin_okfit_mcp__describe_vocabulary` and read `docs_presets` (`name`, `description`, `additive`, `surfaces`). If `docs_presets` is `[]` (profile `none`), tell the user no presets exist for this profile and stop; write no Surfaces. Otherwise pick the base preset for the detected kind (`npm-package`, `monorepo-router`, `monorepo-shared-docs`) and add `site` when `website/` exists, since `site` is additive. Name the recommendation and why; do not apply it silently.

## 3. Ask where each surface lives

Before writing, ask the user where each surface's `resource` points, offering the preset default. Ask for the site's real URL: the `site` preset ships the placeholder `https://example.invalid`, and the user must replace it.

## 4. Write the Surfaces

Gotchas:

- **Never overwrite an existing Surface.** List `okf/surfaces/` first (or `list_concepts`); skip any file that exists and say so.
- **Keep only the variants that match the repo.** In the `site` preset, `readme-package` and `readme-root` both target `../../README.md`. Write the one that fits the shape (root README of a single package: `readme-package`; of a monorepo: `readme-root`), not both.
- Write each preset template's `frontmatter` and `body` to `okf/surfaces/<file>` as given, keeping `status: draft`. Apply the user's resource and URL answers.

## 5. Validate

Run `okfit validate` (or `mcp__plugin_okfit_mcp__validate_bundle`) and fix anything it reports. Then grep `okf/surfaces/` for `example.invalid`; while any match remains, refuse to finish and ask the user for the real URL. Surfaces stay `draft` until the user promotes them.
