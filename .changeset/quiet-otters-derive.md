---
"@okfit/profiles": minor
---

## Features

- `Derivation` gained `bodyDigest(text)`: a lowercase hex sha256 of the
  normalized body (the same normalization `Derivation.body` already
  applies), computed through effect's own `Crypto` service rather than
  `node:crypto`, so it carries `Crypto.Crypto` in its R channel the same
  way `Derivation.generatedAt` carries `Git | GitHistory`.
- `Provenance.lint(bundle, config, options?)` now runs in two tiers
  (issue #19). When a concept records `generated.body_sha256`, drift is
  decided entirely by comparing that digest against the current body's
  digest — no git call at all, so it also catches an edited-but-uncommitted
  body immediately, and it survives a squash or rebase merge that only
  rewrites commit dates. A concept with no recorded digest falls back to
  the original git-derived date comparison. A new optional
  `{ skipGitTier }` option skips that git-derived fallback entirely (no git
  spawn) while leaving the digest tier unaffected; it defaults to `false`,
  so every existing caller's behavior is unchanged.

```ts
import { Provenance } from "@okfit/profiles";

// Skip only the git-derived fallback tier; a recorded digest is still checked.
const diagnostics = yield* Provenance.lint(bundle, config, { skipGitTier: true });
```

## Breaking Changes

- `Provenance.lint`'s requirements channel now includes `Crypto.Crypto`,
  alongside the existing `Git | GitHistory | FileSystem.FileSystem |
  Path.Path`. A caller providing `NodeServices.layer` (or anything built
  on it, like `@okfit/engine`'s `OkfitPlatform`) needs no change; only a
  caller assembling a narrower custom layer for `Provenance.lint` directly
  must add `Crypto.Crypto` to it.
