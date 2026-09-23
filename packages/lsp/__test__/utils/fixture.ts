import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scope } from "effect";
import { Effect } from "effect";

/** `__test__/fixtures/project`, resolved relative to this file rather than `process.cwd()`. */
const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/project", import.meta.url));

/**
 * Copies `__test__/fixtures/project` into a fresh, `realpath`-resolved temp
 * directory and removes it in a scope finalizer. macOS temp directories
 * resolve through `/private/var`; every path a test compares against
 * `root` must go through the same `realpath` call or prefix matching
 * (and `path.resolve`d equality) silently fails.
 *
 * @public
 */
export const copyFixtureProject = (): Effect.Effect<{ readonly root: string }, never, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.promise(async () => {
			const created = await mkdtemp(join(tmpdir(), "okfit-lsp-"));
			const root = await realpath(created);
			await cp(FIXTURE_ROOT, root, { recursive: true });
			return { root };
		}),
		({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
	);
