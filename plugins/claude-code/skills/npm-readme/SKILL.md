---
name: npm-readme
description: >-
  Writes or refreshes a package README: shape detection (single package,
  monorepo root, monorepo sub-package), section order, prose rules, and the
  badge block. Use when creating a new package README or updating an existing
  one's structure or badges. Trigger phrases -- "add badges to this README",
  "scaffold a package README", "what shape is this package", "npm version
  badge", "TypeScript badge".
allowed-tools: Read, Write, Edit, Glob, Grep
---

# npm-readme

This is one self-contained skill, not a delegation (M-7). design-docs'
`user-docs-create-readme` dispatches to a whole `user-docs` agent
(`FIELDSTUDY:283,309-320`); `okf-docs` has no such agent to dispatch to, so
it runs the four steps below itself, directly. No table of contents: this
skill excludes `build-toc` entirely (M-7) -- it never writes a
`## Documentation` list or a `docs/` TOC.

## Shape detection

Read `package.json` for the package's `name`, `license` (SPDX), `engines`
(runtime and range), and the `typescript` dependency's floor version.
Classify the repo as one of:

- **single-package** -- no `workspaces` field, no `pnpm-workspace.yaml`, and
  no sub-`package.json` files under `packages/`.
- **monorepo-root** -- `workspaces` or `pnpm-workspace.yaml` resolves to at
  least one real sub-package outside the root. A self-referential or empty
  workspace (`workspaces: ["."]`, or globs matching nothing) is not a
  monorepo; classify it `single-package` instead.
- **monorepo-sub-package** -- the current `package.json` sits under a path
  the parent's workspace globs match.

Missing `engines` means no runtime badge; missing `typescript` dependency
means no TypeScript badge -- never invent either value. A monorepo-root
README is developer-facing, not npm-facing, and carries no badge block at
all.

## Section order

Write sections in this order, matching `packages/cli/README.md`'s own
skeleton in this repo: title, one-line description, badges, `## Usage`,
one section per command, config discovery, exit codes, `--format json`,
message conventions, `## License` (always last).

## Badge block

Emit the four standard badges -- npm version, License, Runtime, TypeScript
-- skipping any whose backing metadata is missing (never a guessed value).
A monorepo-root README skips the badge block entirely.

Load `references/badge-formats.md` when: writing or normalizing a badge
block. It carries the exact shields.io URL templates, the license color
table, the skip-logic table, the URL-encoding rules, and a worked example.

## Prose rules

- No artificial line-breaks inside a paragraph or list item; a paragraph
  is one line of source and the renderer wraps it.
- Sentence case for headings: first word capitalized, the rest lowercase,
  except acronyms (`CLI`, `XDG`) and proper nouns (`TypeScript`, `Node.js`)
  which keep their case.
- Every fenced code block names a language.
- Files added under `docs/` (if any) use `{NN}-{slug}.md`, two-digit
  zero-padded number then kebab-case slug.
- Do not write specific version numbers in prose; the npm badge and
  `package.json` are the source of truth for the current version.
