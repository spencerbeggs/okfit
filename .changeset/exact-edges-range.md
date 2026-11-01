---
"@okfit/core": patch
---

## Bug Fixes

* `Graph.fromBundle` now ranges each frontmatter edge at its own field, found by its YAML path (`resource`, `sources[i].resource`, `computation`, `executor.resource`, `attester.resource`). Before, a path that appeared twice, such as under both `resource` and `sources`, or earlier in a YAML comment, gave every edge the first occurrence's position. For a double-quoted value, the edge's range now covers the quotes, matching frontmatter lint diagnostics.
