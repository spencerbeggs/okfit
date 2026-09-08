# @okfit/profiles

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
