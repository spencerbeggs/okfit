---
name: docs-badges
description: >-
  Builds or normalizes the standard shields.io badge block at the top of a
  package README, preserving custom badges. Use when adding, fixing or
  refreshing badges ("add badges to this README", "npm version badge",
  "TypeScript badge", "normalize the badge block").
allowed-tools: Read, Edit, Glob, Grep
---

# docs-badges

Emit or normalize the standard badge block of a package README. The package's `package.json` is the only source for badge values; never copy a name or version from existing badge text.

## Rules

- Four standard badges, in this order: npm version, License, Runtime, TypeScript.
- Never invent a value. No `engines` (or a value of `*`, empty or `>=0`) means no runtime badge. No `typescript` dependency means no TypeScript badge. If a skip removes a badge that already exists, say so and ask rather than dropping it silently.
- **A monorepo-root or router README carries no badges.** Remove only the standard four there and keep custom ones.
- Several declared runtimes get one badge each, in the order node, bun, deno.
- **Preserve custom badges** (CI, codecov, downloads, social, sponsorship). A badge is standard only if both its URL pattern and its link target match; a "Node.js Compatibility" badge pointing at a project page is custom. Final block: standard badges first in canonical order, then custom badges in their original order. Never add a custom badge that was not there.
- Locate the existing block as the run of consecutive badge lines after the H1. With no block, insert the standard badges right after the H1.

Read `references/badge-formats.md` when building the URLs: it carries the shields.io templates, color table, URL-encoding rules, the standard-vs-custom identification table and a worked example.

For shape and metadata, use the `docs-detect-shape` skill's detection step. Report what was emitted, what was skipped and why, and which custom badges were kept.
