---
type: Publication
title: Contributor guide -- making a pull request
description: The docs/01-making-a-pull-request.md contributor guide, rendered from the commit, test-location and import conventions.
status: draft
resource: ../../docs/01-making-a-pull-request.md
surface: ../surfaces/contributor-guides.md
renders:
  - path: ../conventions/commits-conventional-dco-no-main.md
    body_sha256: 20e6953f2dd97ce0b778e2680bb1c03906d60cf54ab0966c70384e02ad397b65
  - path: ../conventions/tests-live-in-test-dir.md
    body_sha256: 5595e88be7b5ddae4215c7e91ec12dadd580b49883671ca044bd062d768db161
  - path: ../conventions/relative-imports-js-extension.md
    body_sha256: c58164991f73965f06c20aa885ce548494d03da650cf85506f00abe23ee614c6
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:23:40Z
  body_sha256: dbd60423fcd79163ad37e75c8caae1039e311b313238c0fce9d9d3f0b05fec17
tags:
  - docs
---

# Contributor guide -- making a pull request

A short checklist for a first pull request: branch, code style, tests, commit. It restates three Conventions and nothing else; there is no pull-request Runbook in the bundle, so the guide says nothing about opening or reviewing the PR on the forge.

## Rendering notes

- Audience is a contributor about to commit, so write each rule as an instruction.
- Leave out the `Claude-Session:` trailer; it is specific to the controlling agent session, not a rule for outside contributors.
- Leave out the `CLAUDE.md` line citations; they point at files the reader may not have open.
- A re-render must keep the rules in this order: branch, imports, tests, commit.
