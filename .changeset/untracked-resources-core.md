---
"@okfit/core": minor
---

## Features

* Adds the `resource-ignored` (default `error`) and `resource-untracked` (default `warn`) lint codes and their `[lint]` keys `resource_ignored` and `resource_untracked`, for a `resource` or `sources[].resource` that exists locally but is gitignored or not tracked by git. The config JSON Schema is regenerated.
