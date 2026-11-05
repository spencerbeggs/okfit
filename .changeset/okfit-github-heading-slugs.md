---
"@okfit/core": minor
"@okfit/cli": minor
---

## Breaking Changes

The `broken-links` lint now resolves a `#fragment` against `github-slugger` slugs. Each space in a heading becomes one hyphen with no trimming or collapsing, underscores and combining marks are kept, and repeated headings always get unique slugs.

### Migrating

A link written to the old form now reports `broken-links`. The diagnostic names the new anchor, so each one can be fixed from its own message:

```text
Link target "b.md#a-b" exists but has no heading "#a-b"; did you mean "#a--b"?
```

Run `okfit validate` after upgrading to find them. Headings with an em dash, an ampersand or an underscore are the likely ones: `## A — B` is now `#a--b`, and `## foo_bar` is now `#foo_bar`.

Parity is with `github-slugger`, not with GitHub itself, whose algorithm is not public.
