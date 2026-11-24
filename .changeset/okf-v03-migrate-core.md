---
"@okfit/core": minor
---

## Features

### Non-concept Markdown lint

OKF 0.3 §3.2 allows Markdown files in a bundle that are not concepts, such as a `README.md`. okfit now lets a project say which ones.

- New config key `[bundle] non_concepts`: a list of globs, relative to the bundle root, naming the `.md` files that may be non-concepts. core sets no default. An invalid glob fails config validation.
- New lint `non-concept-unlisted` (config key `non_concept_unlisted`, default `warn`). It fires on a `.md` file that has no frontmatter or no `type` and matches no `non_concepts` glob. It stays silent when `non_concepts` is absent, so a project that does not opt in sees no change. `type-missing` and `frontmatter-missing` are unchanged. There are now forty lint keys.

```toml
[bundle]
non_concepts = ["**/README.md", "docs/notes/**"]
```

### Reading a bundle as another OKF version would

- `Graph.resolve` takes an optional fifth argument, a `FallbackRule` (`"declared" | "legacy" | "current"`, now an exported type), to resolve a reference as an OKF 0.2 or 0.3 reader would, whatever the bundle declares. The default is unchanged.
- `Bundle.inlineComputation(document, reading)` reads an inline computation with the v0.2 or the v0.3 locator.
