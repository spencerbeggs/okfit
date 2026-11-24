---
"@okfit/ai-plugins": minor
---

## Breaking Changes

The skills, agents and the post-edit validate hook teach and report okfit's prefixed frontmatter keys (`x-okfit-integrity` and the `x-okfit-` profile fields). The upgrade skill now runs `okfit sync` before `okfit validate --fix`, since the migration fix refuses a concept still on the old keys. Pair the plugin with an okfit CLI that understands the prefixed keys.
