---
"@okfit/mcp": minor
---

## Breaking Changes

Trust tiers now follow OKF 0.3 §5.3: only verification events dated at or after a concept's last change count. A concept that was verified before its last change used to report `human-reviewed` or `machine-confirmed` and now reports `unverified`, in tool results and in the `list_concepts` `verified` filter. A client that relied on the old tier must re-verify those concepts (`okfit verify`) or handle the lower tier.

## Features

- `drift.reason` may now be `verified-before-change`.
- The `list_concepts` `verified` filter description changed: `true` matches a current, bound human verification, and `false` matches concepts with no current verification (tier unverified).
