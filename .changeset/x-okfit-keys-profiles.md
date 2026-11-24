---
"@okfit/profiles": minor
---

## Breaking Changes

The built-in `software-project` profile fields move under the `x-okfit-` prefix. `kind`, `layer`, `pins`, `supersedes`, `bounds`, `repository`, `gate`, `justifies`, `occurred`, `guard`, `audience`, `url`, `surface`, `renders`, `entry`, `crosses` and `runbooks` become `x-okfit-<field>`, and `links_to` becomes `x-okfit-links-to`. Keys nested inside an okfit mapping take no prefix (`x-okfit-renders[].body`). OKF's own keys, and fields a project declares in its own config, do not move.

- The `required` lists of the built-in types name the prefixed fields, so a `software-project` bundle that has not been migrated reports `required-key-missing`. Run `okfit sync` to rename the keys.
- `SurfaceTemplate.frontmatter` keys in the surface presets use the prefixed names.
- `Canonical.EXCLUDED_KEYS` now excludes `x-okfit-integrity` and no longer excludes a bare `integrity`. Renaming `integrity` changes no content digest. Renaming a profile key does, so a verified concept that carries a profile field reads as `verified-drift` until a human re-runs `okfit verify`.
- A user config that names a built-in field by its bare key (`required = ["kind"]`, or its own `[types.Module.fields.kind]` table) is not touched by `okfit sync` for that field; update it by hand.

## Features

New exports `ProfileKeys` (field name to key spelling), `PROFILE_FIELD_NAMES`, and the types `ProfileFieldName` and `ProfileKey`, so code builds a profile key from a name instead of writing the literal.
