---
type: Decision
title: The plugin declares a minimum CLI version and the context envelope reports the CLI's
description: "plugin/ owns an explicit MIN_CLI_VERSION floor, injected into the hook library, and okfit context --format json carries cli_version, so the SessionStart hook can tell a project to update an older CLI; the floor moves only when a hook or skill needs a newer CLI feature."
status: draft
tags:
  - architecture
  - release
sources:
  - id: min-cli
    resource: ../../plugin/min-cli.ts
  - id: orientation-hook
    resource: ../../plugin/hooks/session-start/orientation.sh
  - id: issue-221
    resource: https://github.com/spencerbeggs/okfit/issues/221
generated:
  by: okfit/claude-code
  at: 2026-11-21T01:53:33Z
x-okfit-integrity:
  generated:
    body: a9f3aa66e2cc7d35
---

# The plugin declares a minimum CLI version and the context envelope reports the CLI's

## Context

The plugin (`@okfit/ai-plugins`) and the CLI (`@okfit/cli`, usually through
`@okfit/plugin`) are versioned and released separately. A project can run a
new plugin against an old CLI, where a hook or skill silently degrades: the
vocabulary is missing a field, a flag is rejected. Nothing told the agent or
the human that the pair had drifted.

## Decision

- `okfit context --format json` carries `cli_version`, the running
  `@okfit/cli` version (`null` when the envelope is built outside the CLI,
  as the MCP `describe_vocabulary` tool does). The change is additive.
- `plugin/min-cli.ts` exports `MIN_CLI_VERSION`, the oldest CLI the plugin's
  hooks and skills work with. `pluginfinity.config.ts` injects it as the
  session variable `OKFIT_MIN_CLI_VERSION`, the same shape as the VS Code
  extension's `MIN_SERVER_VERSION`.
- The SessionStart hook adds one line to `additionalContext` when the
  resolved CLI is older than the floor, or when the envelope has no
  `cli_version` (a CLI that predates the field is older by definition). It is
  silent when the CLI is supported.
- Release discipline: the floor is bumped only when a hook or skill starts
  depending on a CLI feature newer than the current floor, in the same
  change that adds the dependency. It is never bumped as a routine release
  step. `packages/plugin/__test__/minCliVersion.test.ts` asserts the floor
  never exceeds the workspace `@okfit/cli` version, so a floor can never
  name a release that does not exist yet.

## Alternatives rejected

- Lockstep versions for the plugin and the CLI. The two release on
  different cadences for different reasons; forcing equal versions would cut
  releases with no change in one of them.
- Comparing against the plugin's own version. It says nothing about which CLI
  features the plugin needs, and a plugin patch would falsely demand a CLI
  update.
- Detecting features by probing (try a flag, read the failure). Each probe
  costs a subprocess in a hook that deliberately runs one, and a failed probe
  is indistinguishable from a real error.
- Treating a missing `cli_version` as supported. Every CLI that predates the
  field would then pass the check, which is exactly the population the check
  exists to catch.

## Consequences

- A floor that is too high nags projects that still work; a floor that is
  never bumped stops warning. Both are caught in review of the change that
  adds a CLI dependency, not by tooling.
- A project `.env` can override `OKFIT_MIN_CLI_VERSION`, which is how a team
  silences the line deliberately.
