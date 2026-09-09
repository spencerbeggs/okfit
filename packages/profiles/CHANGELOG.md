# @okfit/profiles

## 0.3.0

### Breaking Changes

- `Provenance.lint`'s requirements channel now includes `Crypto.Crypto`,
  alongside the existing `Git | GitHistory | FileSystem.FileSystem |
  Path.Path`. A caller providing `NodeServices.layer` (or anything built
  on it, like `@okfit/engine`'s `OkfitPlatform`) needs no change; only a
  caller assembling a narrower custom layer for `Provenance.lint` directly
  must add `Crypto.Crypto` to it. [#49][#49]

### Features

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

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.2.0 | 0.3.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#49]: https://github.com/spencerbeggs/okfit/pull/49

## 0.2.0

### Features

- First usable release of `@okfit/profiles`: named, opinionated configuration profiles built on `@okfit/core`. A profile is a complete `OkfitConfig` value plus derivation rules for `generated.at` and `generated.by`; core itself stays opinion-free.

#### The `software-project` profile

- `Profiles.softwareProject` describes a software repository's knowledge bundle: five concept types (`Project`, `Module`, `Decision`, `Convention`, `Interface`, `Reference`) and five tags (`architecture`, `testing`, `release`, `security`, `performance`). `Profiles.get(name)` resolves a profile by exact name. `Profiles.softwareProject.check(bundle)` additionally enforces that exactly one `Project` concept exists and lives at the bundle root.

```ts
import { Profiles } from "@okfit/profiles";
import { Option } from "effect";

const profile = Profiles.get("software-project"); // Option.some(...)
```

#### Layout scaffolding

- `Profiles.softwareProject.layout` describes the file tree `okfit init` scaffolds for this profile — the root `index.md`, `log.md`, `project.md`, and one directory per concept type — kept separate from the config value itself.

#### Derivation from git

- `Derivation` computes `generated.at` from a concept's git history (the author date of the commit whose blob first differs from its predecessor, using `@effected/git`'s `Git.log` with `firstParentDiffMerges` to catch conflict-resolving merges), resolves the human actor from git identity against `config.actors.humans`, and computes `stale_after` as a pure addition on top of `generated.at`. An uncommitted body is reported as `{ _tag: "uncommitted", reason: "untracked" | "dirty" | "unborn" }` rather than silently substituting the current time.

#### Provenance lint

- `Provenance.lint(bundle, config)` is the `generated-at-drift` lint (`lint.generated_at_drift`, default severity `"info"`): it flags a committed concept whose `generated.at` no longer matches the instant its body was actually last changed, comparing decoded `DateTime.Utc` values and reporting both instants plus a 7-character commit sha in the message. It is silent for uncommitted concepts and returns nothing outside a git repository. [#16][#16]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.1.0 | 0.2.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#16]: https://github.com/spencerbeggs/okfit/pull/16

## 0.1.0

### Features

- Bootstrap the okfit monorepo with package skeletons for core, profiles, cli, mcp, plugin, and the Claude Code plugin.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
