---
"@okfit/cli": minor
---

## Features

### `sync --since` and `sync --staged`

```bash
okfit sync --since 2026-09-01   # log mode's inclusive floor
okfit sync --staged             # pre-commit mode
```

`--since <YYYY-MM-DD>` sets log mode's inclusive floor, overriding the default of the newest date already in `log.md`.

`--staged` stamps only the concepts currently in the git index — meant for a pre-commit hook — using `now` as `generated.at` and re-adding what's written. It defaults `--only` to `generated` and `index`; combining it with `--only log` fails at exit `64`.

### `verify --all` and `verify --type`

The concept id is now optional. Pass `--all` to attest every unverified concept whose type declares `require_verified`, or `--type <Type>` (repeatable) to narrow (or, without `--all`, define) the batch:

```bash
okfit verify --all
okfit verify --type Decision --type Convention
```

Giving both an id and `--all`/`--type`, or neither, fails with a usage error at exit `64`.
