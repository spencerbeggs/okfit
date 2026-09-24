import { LaunchContext } from "@effected/engine";

/**
 * N-21's precedence: `OKFIT_PROJECT_DIR`, else `CLAUDE_PROJECT_DIR`, else
 * `cwd`. Pure over its `env`/`cwd` arguments so tests never touch
 * `process.env`/`process.cwd()` -- both are read once, in `main.ts`, and
 * passed down as plain values (`main.ts` is the only place this package
 * reads `process`).
 *
 * Built on `@effected/engine`'s `LaunchContext.projectDir` with an empty
 * `argv`: this server has no command parser and `start-mcp.sh` forwards no
 * positional arguments, so the only candidates are the two env keys and the
 * cwd fallback. `LaunchContext.projectDir` additionally treats a value
 * still carrying a literal `${VAR}` placeholder as unusable -- protection
 * the old hand-rolled `??` chain did not have -- against an agent host that
 * leaves `CLAUDE_PROJECT_DIR` unexpanded in some launch paths.
 *
 * @internal
 */
export const resolveMcpProjectRoot = (env: NodeJS.ProcessEnv, cwd: string): string =>
	LaunchContext.projectDir({ argv: [], env, keys: ["OKFIT_PROJECT_DIR", "CLAUDE_PROJECT_DIR"], cwd });
