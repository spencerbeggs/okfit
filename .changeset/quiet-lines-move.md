---
"@okfit/cli": patch
---

## Documentation

* `okfit validate`'s text output now reports the line and column of the offending value for lint diagnostics that used to point at the start of the frontmatter block (`unknown-type`, `field-value-unknown`, `actor-prefix-unknown`, `stale`, `require-verified-unmet`), and `generated-at-drift`, `source-resource-missing`, `project-multiple` and `project-not-at-root` now carry a position where they had none. The JSON output's `range` field moves the same way. Tools that parse positions out of the text output should expect the new anchors; the diagnostic codes and files are unchanged.
