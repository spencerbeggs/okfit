import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scope } from "effect";
import { Effect } from "effect";

/** `__test__/fixtures/project`, resolved relative to this file rather than `process.cwd()`. */
const FIXTURE_ROOT = fileURLToPath(new URL("../../fixtures/project", import.meta.url));

/**
 * One hermetic per-test filesystem: an isolated `cwd` (the fixture project
 * copied into it) and an `env` pointing `HOME` and all four `XDG_*`
 * variables at temp directories under the same root, so the XDG fallback
 * chain never leaks a host path. The mechanics are copied from
 * `packages/cli/__test__/e2e/utils/fixtures.ts#makeSandbox`, with the
 * `okfit-lsp-` prefix and, since every one of this package's e2e tests
 * needs the fixture project on disk, a `copyFixtureInto(cwd)` step folded
 * into sandbox creation itself.
 *
 * @public
 */
export interface Sandbox {
	readonly cwd: string;
	readonly env: Record<string, string>;
}

const buildSandbox = async (prefix: string, options?: { readonly home?: boolean }): Promise<Sandbox> => {
	const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
	const cwd = join(root, "cwd");
	const home = join(root, "home");
	const xdgConfig = join(root, "xdg-config");
	const xdgState = join(root, "xdg-state");
	const xdgCache = join(root, "xdg-cache");
	const xdgData = join(root, "xdg-data");
	await Promise.all([cwd, home, xdgConfig, xdgState, xdgCache, xdgData].map((dir) => mkdir(dir, { recursive: true })));
	const includeHome = options?.home ?? true;
	const env: Record<string, string> = {
		PATH: process.env.PATH ?? "",
		XDG_CONFIG_HOME: xdgConfig,
		XDG_STATE_HOME: xdgState,
		XDG_CACHE_HOME: xdgCache,
		XDG_DATA_HOME: xdgData,
		NO_COLOR: "1",
	};
	if (includeHome) {
		env.HOME = home;
	}
	return { cwd, env };
};

const removeSandbox = (sandbox: Sandbox): Promise<void> => rm(dirname(sandbox.cwd), { recursive: true, force: true });

/**
 * `node:fs/promises` `cp(from, to, { recursive: true })` into a destination
 * that must not already exist as a non-empty directory.
 *
 * @public
 */
export const copyFixtureInto = (from: string, to: string): Promise<void> => cp(from, to, { recursive: true });

/**
 * Builds a hermetic sandbox with the fixture project already copied into
 * `cwd`, removing the whole temp root in a scope finalizer.
 *
 * @public
 */
export const makeSandbox = (
	prefix = "okfit-lsp-",
	options?: { readonly home?: boolean },
): Effect.Effect<Sandbox, never, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.promise(async () => {
			const sandbox = await buildSandbox(prefix, options);
			await copyFixtureInto(FIXTURE_ROOT, sandbox.cwd);
			return sandbox;
		}),
		(sandbox) => Effect.promise(() => removeSandbox(sandbox)),
	);
