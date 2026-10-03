---
type: Publication
title: Contributor guide -- making a pull request
description: The docs/01-making-a-pull-request.md contributor guide, rendered from the commit, test-location and import conventions.
status: draft
resource: ../../docs/01-making-a-pull-request.md
surface: ../surfaces/contributor-guides.md
renders:
  - path: ../conventions/commits-conventional-dco-no-main.md
  - path: ../conventions/tests-live-in-test-dir.md
  - path: ../conventions/relative-imports-js-extension.md
generated:
  by: okfit/claude-code
  at: 2026-10-03T00:23:03Z
  body_sha256: 6237c4d0eccefecf3b389dce3a6566734270a1d9e61c796c8877bb76b1530371
tags:
  - docs
---

# Contributor guide -- making a pull request

A short checklist for a first pull request: branch, code style, tests, commit. It restates three Conventions and nothing else; there is no pull-request Runbook in the bundle, so the guide says nothing about opening or reviewing the PR on the forge.

## Rendering notes

- Audience is a contributor about to commit, so write each rule as an instruction.
- Leave out the `Claude-Session:` trailer; it is specific to the controlling agent session, not a rule for outside contributors.
- Leave out the `CLAUDE.md` line citations; they point at files the reader may not have open.
- A re-render must keep the three rules in this order: branch and commit, imports, tests.
