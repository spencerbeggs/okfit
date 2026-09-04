# @okfit/profiles

Opinionated layer over `@okfit/core`. Ships named profiles: a complete okfit
config value (types, tags, fields, lint severities) plus derivation code
(`generated.at` from git, human actor from git config). Core stays
opinion-free; everything that says what a bundle *should* contain lives here.

## Layout

```text
src/
  index.ts    -- public barrel
```

Tests live in `__test__/`, never in `src/`.
