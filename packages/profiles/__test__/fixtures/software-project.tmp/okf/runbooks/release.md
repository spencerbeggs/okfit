---
type: Runbook
title: Release a package
description: The changeset-driven flow that publishes a package to npm.
resource: ../../.github/workflows/release.yml
tags: [release]
---

# Release a package

Trigger: a changeset merged to main. Steps: version, build, publish, tag. Done when the tag exists and npm shows the version.
