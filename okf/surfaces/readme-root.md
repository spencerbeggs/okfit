---
type: Surface
title: Repository README
description: "The monorepo root README: a hub that explains the packages and how they relate."
status: draft
kind: readme
audience: contributors
resource: ../../README.md
generated:
  by: okfit/claude-code
  at: 2026-10-03T01:30:23Z
  body_sha256: dd09f8ef62245167425b60a81a9291d96c4f719c4a0a2fcdf90ac9211b93c8c3
tags:
  - docs
---

# Repository README

## Who reads this

People who landed on the repository and need to find the package they want. This page routes; it does not document any one package.

## Required structure

Follow this outline. Carry no badges on this page; they belong on each package README.

```markdown
# <repo-name>

<one paragraph: what the repository is and where it sits in its ecosystem>

## Packages

<table with Package and Purpose columns, each package linked to its directory>

## Install

<the common install command, or a pointer to each package README>

## Requirements

- <runtime> <engine range>

## License

[<license>](LICENSE)
```

Add an Ecosystem section only when the repository spans related but separate packages.

## okfit specifics

The root README is the first thing a contributor sees. It lists the `@okfit/*` packages, names the Claude Code plugin in `plugins/claude-code`, and points contributors to the guides in `docs/`.

## Other surfaces

Per-package install and usage belong in each package README; contributor workflow belongs in contributor docs.

## Prose rules

- Use sentence case for every heading: `## API reference`, not `## API Reference`. Acronyms and proper nouns keep their case.
- Put every paragraph and list item on one source line; never hard-wrap prose.
- Give every code fence a language identifier.
- Show the expected output of every example that logs a value or runs a command, as comments on the lines after it: `// ...` for JavaScript and TypeScript, `# ...` for shell.
- Never invent output, paths, identifiers or messages; when the real output cannot be verified from the source or by running the command, write a generic placeholder such as `# example output (varies by environment)`.
- Lead install commands with npm or npx and list at most one alternative (pnpm, yarn or bun) below it, unless the page is about package-manager-specific behavior.
- Never write a specific version number in prose; the npm badge and `package.json` are the source of truth. Do not state versions except in a migration guide between major versions.
- Match the language of the surrounding source and docs, and avoid filler, hype and AI-sounding phrasing.
- Never invent a tagline, feature or example: take them from `package.json`, the exported symbols and existing docs, and ask when none exist.
