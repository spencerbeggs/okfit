---
"@okfit/mcp": patch
---

## Bug Fixes

- `validate_bundle` now declares `Crypto.Crypto` among its dependencies,
  matching the `Crypto.Crypto` requirement `@okfit/profiles`' two-tier
  `generated-at-drift` lint (issue #19) now carries. The tool's parameters
  and output shape are unchanged; this only wires the dependency the
  underlying lint already needed to run correctly.
