/**
 * `MIN_CLI_VERSION`: the oldest `@okfit/cli` this plugin's hooks and skills
 * work with. `pluginfinity.config.ts` injects it into the hook library as the
 * session variable `OKFIT_MIN_CLI_VERSION`, and the SessionStart hook
 * (`hooks/session-start/orientation.sh`) compares it to the `cli_version` the
 * project's `okfit context --format json` reports.
 *
 * Bump it only when a hook or skill starts depending on a CLI feature newer
 * than this version, in the same change; never as a routine release step.
 * `packages/plugin/__test__/minCliVersion.test.ts` asserts it never exceeds
 * the workspace `@okfit/cli` version. See
 * `okf/decisions/plugin-declares-minimum-cli.md`.
 */
export const MIN_CLI_VERSION = "0.16.7";
