---
type: Convention
title: Commits are conventional, DCO signed, never on main
description: Every commit uses a conventional-commit subject, carries a DCO sign-off trailer, and never lands directly on main.
status: stable
generated:
  by: human:spencer
  at: 2026-09-06T10:47:04Z
  body_sha256: 20e6953f2dd97ce0b778e2680bb1c03906d60cf54ab0966c70384e02ad397b65
tags:
  - release
stale_after: "2026-12-05T00:00:00Z"
---

# Commits are conventional, DCO signed, never on main

## Rule

Every commit's subject follows the conventional-commit form
(`type(scope): summary`), every commit carries a `Signed-off-by:` DCO
trailer, and no commit lands directly on `main` — work happens on a branch
first (root `CLAUDE.md:41`, `packages/cli/CLAUDE.md:123`).

## Why

A conventional subject makes changelog generation mechanical — `@savvy-web/changelog`
reads the type and scope to sort a commit into the right changeset
section. The DCO sign-off is the legal provenance record for the
contribution. A protected `main` means every change is reviewed on a
branch before it merges, never pushed straight to the branch other work
builds on.

## Mechanics in this repo

One branch per task, commit through `/silk:commit-create`'s contract (a
message file, never a raw `git commit` message string), and a
`Signed-off-by:` trailer for DCO. This repository's own commits also carry
a second trailer, `Claude-Session:`, naming the controlling session — an
addition on top of the DCO trailer, not a replacement for it.

## Where stated

Root `CLAUDE.md:41` (commits are conventional, DCO signed, never on `main`);
`packages/cli/CLAUDE.md:123` (the same rule restated for this package).
