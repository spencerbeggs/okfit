---
type: Convention
title: Never flip private in a source package.json
description: '@savvy-web/bundler flips "private" on publish; a source package.json never sets "private": false itself, and no changeset is written before the initial release.'
status: stable
generated:
  by: human:spencer
  at: 2026-10-06T04:20:11Z
  body_sha256: fe6a4926e2e877ff4124874c07850a543e97eaaa626ecbba713d69272792e151
tags:
  - release
stale_after: "2026-12-05T00:00:00Z"
---

# Never flip private in a source package.json

## Rule

`@savvy-web/bundler` produces `dist/dev` and `dist/prod` per package and
flips `"private"` on publish; no source `package.json` ever sets
`"private": false` itself (root `CLAUDE.md:59-60`).

## Why

`"private": false` in a source `package.json` would make the package
publishable by an ordinary `npm publish` run outside the bundler's own
release flow, bypassing the version- and changelog-generation machinery
that flow is responsible for entirely.

## Changesets, and why none exist yet

Changesets with `@savvy-web/changelog` eventually version every package
(root `CLAUDE.md:61`), but no changeset is written against this bundle
today — a standing rule from Spencer, not a `CLAUDE.md` line. Every package
in this repository already shipped once as an unversioned skeleton, and a
changeset written against a skeleton would auto-publish it prematurely, so
changesets stay off the table until Spencer explicitly calls the initial
release.

## The plugin's exception

`plugin/` (`@okfit/ai-plugins`) is tagged but never published to npm; its
built `plugin.json` files (Claude Code and Copilot) mirror its own
`package.json` version rather than being set independently, via
`.changeset/config.json` (root `CLAUDE.md:62-63`,
`plugin/CLAUDE.md:3-10`).

## Where stated

Root `CLAUDE.md:57-63`; `plugin/CLAUDE.md:3-10,12-18`.
