---
"@okfit/profiles": minor
---

## Breaking Changes

The software-project profile now sets `[bundle] non_concepts` to `**/README.md`, `**/AGENTS.md`, `**/CONTRIBUTING.md` and `**/SKILL.md`, the four names OKF 0.3 §3.2 lists. A bundle on this profile that holds any other `.md` file without frontmatter or without a `type` now gets a `non-concept-unlisted` warning from `okfit validate`, with no change on your side.

To clear the warning, do one of these:

- Give the file frontmatter with a `type`.
- Move the file out of the bundle.
- Set `[bundle] non_concepts` in your project config. A value you set replaces the profile's list, so repeat any of the four names you still need.
- Set the lint to `off`.

```toml
[bundle]
non_concepts = ["**/README.md", "**/SKILL.md", "docs/notes/**"]

[lint]
non_concept_unlisted = "off"
```

The warning does not change the exit code of `okfit validate`.
