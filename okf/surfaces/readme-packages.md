---
type: Surface
title: Sub-package READMEs
description: A one-page README inside each monorepo package that routes readers to the documentation site.
status: draft
kind: readme
audience: users
resource: ../../packages/*/README.md
links_to: site.md
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:23:03Z
  body_sha256: 0f10afd7304dea576ffdb8bc798f03e47a6a00424dcaba8743b8acb03212a056
tags:
  - docs
---

# Sub-package READMEs

## Who reads this

People installing one package from npm. The documentation site carries the full guides, so each page stays short.

## Required structure

Write exactly this and nothing more: the title, the badges, a tagline, the install command, one quick start, and a prominent link to the package's page on the documentation site.

```markdown
# <package-name>

<badges, built with the docs badge tooling rather than typed by hand>

<one-paragraph tagline>

## Install

<npm command and at most one alternative line>

## Quick start

<one minimal example with expected output as comments>

**Full documentation: <link to the site>**
```

## okfit specifics

Each package under `packages/` is published under the `@okfit` scope. Link the quick start to the package's page on <https://okfit.dev>.

## Other surfaces

Anything longer than a quick start belongs on the documentation site this surface links to.

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
