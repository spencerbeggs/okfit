/**
 * N-21's precedence, exactly: `OKFIT_PROJECT_DIR`, else
 * `CLAUDE_PROJECT_DIR`, else the process's working directory. Pure over
 * its `env` argument so tests never touch `process.env`. No argv flags:
 * `start-mcp.sh` forwards `"$@"` with nothing in it, and the manifest's
 * `cwd` field is unused.
 *
 * @public
 */
export const resolveMcpProjectRoot = (env: NodeJS.ProcessEnv): string =>
	env["OKFIT_PROJECT_DIR"] ?? env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
