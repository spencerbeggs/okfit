---
"@okfit/mcp": minor
---

## Features

* `list_concepts` accepts `verified`, `drifted`, `stale` and `now` parameters to filter by trust signal
* Concept summaries carry `tier`, `integrity` and `stale`
* `get_concept` returns `tier`, `integrity` and `stale`, plus `drift` when a verified concept's content changed
* `stale_report` includes a `drifted` list
* The server instructions explain the trust signal to agents

## Breaking Changes

The `verified` parameter of `list_concepts` now selects verified concepts whose content is still current, not any concept ever verified. Pass `drifted` to find concepts edited after verification.
