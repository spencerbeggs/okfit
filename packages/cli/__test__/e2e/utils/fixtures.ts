import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * One hermetic per-test filesystem: an isolated `cwd` and an `env` pointing
 * `HOME` and all four `XDG_*` variables at temp directories under the same
 * root, so the XDG fallback chain never leaks a host path (K-43).
 */
export interface Sandbox {
	readonly cwd: string;
	readonly env: Record<string, string>;
}

/**
 * `mkdtemp(join(tmpdir(), "okfit-cli-"))`, plus the five env directories
 * under it (contract section 6.3). `PATH` is passed through unmodified;
 * every other variable is a fresh, empty directory under the sandbox root so
 * a real `HOME`/`XDG_*` value on the host machine can never be read.
 *
 * `options.home` defaults to `true`; pass `false` to build a sandbox with no
 * `HOME` entry at all (still creating the directory on disk, unused) — the
 * one case that needs it is proving the K-13 `XdgEnvError` path (an unset
 * `HOME`) reaches `renderFailure` and exits `3` rather than crashing with a
 * raw stack trace.
 */
export const makeSandbox = async (prefix = "okfit-cli-", options?: { readonly home?: boolean }): Promise<Sandbox> => {
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

/**
 * Removes a sandbox's whole temp root. `cwd` is always `<root>/cwd`
 * (`makeSandbox`), so the root is `dirname(sandbox.cwd)` — this keeps
 * `Sandbox`'s public shape exactly the two fields the contract names, with
 * no separate `root` field to track.
 */
export const removeSandbox = (sandbox: Sandbox): Promise<void> =>
	rm(dirname(sandbox.cwd), { recursive: true, force: true });

/**
 * `node:fs/promises` `cp(from, to, { recursive: true })` into a destination
 * that must not already exist as a non-empty directory — copy each fixture
 * into a fresh subdirectory of a `Sandbox`'s `cwd`, never onto `cwd` itself
 * when more than one fixture is needed in one test.
 */
export const copyFixtureInto = (from: string, to: string): Promise<void> => cp(from, to, { recursive: true });
