# @okfit/profiles

Named configuration profiles for [okfit](https://github.com/spencerbeggs/okfit). A profile is a complete okfit config plus derivation rules. The first profile, `software-project`, describes a software repository's knowledge bundle.

> **Pre-release.** Part of the `@okfit/*` kit, in early development.

## Status

Skeleton. The public surface is `PROFILE_NAMES` only.

## The `software-project` config

The profile sets only `[concepts]`, `[types]` and `[tags]`; `okf_version`,
`[bundle]`, `[lifecycle]`, `[actors]` and `[lint]` come from
`OkfitConfig.DEFAULTS`, and a project's own `config.toml` is merged on top
(`DEFAULTS < profile < file`). `actors.agent` is deliberately left for the
project to set. The block below is checked against the shipped value by the
package's tests, so it never drifts.

```toml
[concepts]
required = ["title", "description"]
tags.required = []

[types.Project]
description = "The repository's root concept: its purpose, boundaries, and non-goals."
guidance = "Exactly one Project exists and it lives at the bundle root as the project file. State the purpose in one paragraph and list what is deliberately out of scope so a reader never infers boundaries from silence."

[types.Module]
description = "A unit of code with an owner and a boundary."
guidance = "One per workspace package, plugin, website, or action. Link to the Decisions that shaped it and the Conventions it is bound by."
required = ["resource", "kind"]

[types.Module.fields.kind]
description = "What sort of unit this is; drives which conventions apply."
values.workspace = "The monorepo root: tooling, CI, release, shared config."
values.package = "A publishable npm package under packages/."
values.website = "A docs or marketing site, usually RSPress."
values.plugin = "A Claude Code or editor plugin distributed outside npm."
values.action = "A GitHub Action."

[types.Module.fields.resource]
description = "The repo-relative path this Module documents, normally the package root."
kind = "path"

[types.Decision]
description = "A choice made, the alternatives rejected, and why."
guidance = "Never edit a stable Decision; deprecate it and write a new one that names it in supersedes. A Decision counts as settled only once a human has verified it."
require_verified = true

[types.Decision.fields.supersedes]
description = "The Decision this one replaces."
kind = "path"

[types.Convention]
description = "A rule contributors and agents must follow."
guidance = "State the rule as an instruction rather than a description of current behaviour. Give it a staleness window so it is re-examined on a cadence instead of rotting silently."

[types.Interface]
description = "A contract others depend on."
guidance = "Document the contract from the consumer's side: what stays stable, not how it is built. Point resource at the file, endpoint, or schema the promise lives in."
required = ["kind"]

[types.Interface.fields.kind]
description = "What kind of contract this is."
values.api = "A programmatic library surface: exported functions, classes, and types."
values.cli = "A command-line interface: commands, flags, and exit codes."
values.config = "A configuration file schema other tools read or write."
values.wire = "A network or IPC wire format."
values.mcp = "An MCP tool or resource surface."

[types.Interface.fields.resource]
description = "The repo-relative path to the thing this Interface documents."
kind = "path"

[types.Reference]
description = "Mirrored external material kept under the references directory."
guidance = "Only for material this repository must cite reliably even if the original moves. Every Reference declares where it came from in sources."
required = ["sources"]

[tags.architecture]
description = "Concerns the shape of the system rather than one module."

[tags.testing]
description = "Concerns how the system is verified: strategy, fixtures, and coverage policy."

[tags.release]
description = "Concerns how changes ship: versioning, changelogs, publishing, and tagging."

[tags.security]
description = "Concerns trust boundaries, secrets, permissions, or attack surface."

[tags.performance]
description = "Concerns speed, memory, or resource cost and the trade-offs made for them."
```

## License

[MIT](LICENSE)
