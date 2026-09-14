---
type: DataModel
title: Lint table
description: The table of lint codes every severity default and config key is derived from.
resource: ../../packages/core/src/OkfitConfig.ts
---

# Lint table

One entry per lint code; the config schema and the CLI's exit tally are both derived from it. A missing entry silently drops a rule from validate.
