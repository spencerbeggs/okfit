---
name: docs-render
description: >-
  Re-renders a published page from the concepts a Publication names, then
  restamps its digests. Use when a Publication drifts (the publication-drift
  lint fires), when asked to "re-render", "refresh" or "update the published
  page" for a Publication, or after a source concept changes.
allowed-tools: Read, Edit, Write, Skill, Bash(okfit sync:*), Bash(okfit validate:*), Bash(pnpm exec okfit sync:*), Bash(pnpm exec okfit validate:*), Bash(npx okfit sync:*), Bash(npx okfit validate:*), Bash(node_modules/.bin/okfit sync:*), Bash(node_modules/.bin/okfit validate:*), mcp__plugin_okfit_mcp__get_concept, mcp__plugin_okfit_mcp__list_concepts, mcp__plugin_okfit_mcp__concept_neighbors, mcp__plugin_okfit_mcp__validate_bundle
---

# docs-render

Input: a Publication concept id (for example `publications/readme-cli`). If none is given, list `publications/` with `list_concepts` and ask.

## Procedure

1. `get_concept` the Publication. Note `resource` (the page), `surface` and `renders` (each `{ path, body_sha256 }`). The Publication body holds rendering notes: what is audience-specific, what is left out, what a re-render must keep.
2. `get_concept` the Surface it names. Its body is the style guide for the page; it overrides any template default (see `docs-templates`).
3. `get_concept` each `renders` source. These are the only fact source.
4. Check for orphans before writing anything. If `validate_bundle` (or `okfit validate`) reports `publication-orphan` for this Publication (a `renders` path or the surface does not resolve), stop and tell the user. Never guess a replacement source.
5. Rewrite the page at `resource` to the Surface's rules and the Publication's notes, using only facts from those sources. Anything else the page says is dropped or flagged to the user, never invented. Keep `docs-badges` blocks via that skill, and reach for `docs-templates` for section order.
6. Run the `docs-humanize` skill on the page.
7. Run `okfit sync --publication <concept id>` (or the same command through `pnpm exec okfit`, `npx okfit` or `node_modules/.bin/okfit`, whichever the repo installs). It restamps the `body_sha256` digests. Exit codes:
   - `64`: the id is unknown, the concept is not a Publication, or a `renders` entry points at no concept (the message names the missing source). Fix the id or the entry; never retry unchanged.
   - `3`: `renders` is not a block-style list of `{ path, body_sha256 }` entries. Fix the frontmatter shape by hand.
8. Run `okfit validate` and confirm `publication-drift` no longer fires for this Publication. Fix anything else it reports. `publication-drift` is a warning and does not fail `okfit validate`; only error severities change the exit code, so a clean exit can still carry warnings to fix.

## Gotcha

**Never restamp without re-rendering.** `okfit sync --publication` only records the sources' current digests; it does not check the page. Running it alone makes drift vanish while the page is still stale, which is the exact failure the lint exists to catch. Do step 4 first, always, even when the diff looks trivial.

**A source edit that adds no fact still needs a restamp.** The digest covers the source's whole body, so a wording-only change makes the page drift. Re-read the sources, re-render, and if the page text comes out unchanged, leave the page as it is and run the restamp anyway. Never invent a change to the page, and never skip the restamp.

**Uncommitted Publication edits.** A plain `okfit sync` skips a concept whose body differs from HEAD (reported as skipped, dirty), so an edited Publication body keeps its own stamp stale until the edit is committed. Expect that skip; commit the Publication edit, then re-run `okfit sync`. `okfit sync --publication` still restamps `renders` in the working tree, so run it after the page is rendered, then commit the page and the Publication together.
