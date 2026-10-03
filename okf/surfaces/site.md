---
type: Surface
title: Documentation site
description: "The published documentation website: guides, reference and tutorials for people using the project."
status: draft
kind: site
audience: users
resource: ../../website/content
url: "https://okfit.dev"
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:23:03Z
  body_sha256: 6fe0ad2acfe0c2249b718223d9eaf91b449c49f6db302690926a4e7be8037f97
tags:
  - docs
---

# Documentation site

## Who reads this

People using the project who want guides, reference and worked tutorials. This is the long-form home; the READMEs only point here.

## Required structure

Organize pages by what the reader is trying to do: a getting-started path first, task guides next, reference last. Give every page one clear job, a sentence-case title and a short summary before the first heading. Link between pages instead of repeating their content.

Replace the placeholder `url` in this concept's frontmatter with the real published address before relying on it.

## okfit specifics

The content root is `website/content`, built with RSPress. User docs live under `/docs`; each package has its own page hierarchy beside its generated API reference. Concept ids, `okf/` internals and contributor workflow stay out of the site.

## Other surfaces

The README carries only the pitch, the install command and one quick start, and links here for everything else; contributor workflow belongs in contributor docs.

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
