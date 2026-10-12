---
type: Publication
title: Contributor guide -- making a pull request
description: The docs/01-making-a-pull-request.md contributor guide, rendered from the commit, test-location and import conventions.
status: draft
resource: ../../docs/01-making-a-pull-request.md
surface: ../surfaces/contributor-guides.md
renders:
  - path: ../conventions/commit-rules.md
    body: 20e6953f2dd97ce0
  - path: ../conventions/test-location.md
    body: 1d7e24bb71b625ab
  - path: ../conventions/relative-imports-js-extension.md
    body: c58164991f73965f
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:23:40Z
tags:
  - docs
integrity:
  generated:
    body: dbd60423fcd79163
---

# Contributor guide -- making a pull request

A short checklist for a first pull request: branch, code style, tests, commit. It restates three Conventions and nothing else; there is no pull-request Runbook in the bundle, so the guide says nothing about opening or reviewing the PR on the forge.

## Rendering notes

- Audience is a contributor about to commit, so write each rule as an instruction.
- Leave out the `Claude-Session:` trailer; it is specific to the controlling agent session, not a rule for outside contributors.
- Leave out the `CLAUDE.md` line citations; they point at files the reader may not have open.
- A re-render must keep the rules in this order: branch, imports, tests, commit.
