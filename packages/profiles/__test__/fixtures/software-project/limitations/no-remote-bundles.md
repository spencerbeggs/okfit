---
type: Limitation
title: Bundles must be local
description: The CLI cannot load a bundle from a URL or a package.
bounds: ../interfaces/cli.md
---

# Bundles must be local

Point `okfit validate` at a URL and it reports a missing directory. Acceptable because every consumer so far vendors its bundle; a fix needs a fetch layer.
