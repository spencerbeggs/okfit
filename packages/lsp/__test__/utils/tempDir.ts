import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "effect";
import { Effect } from "effect";

/**
 * A fresh, `realpath`-resolved temp directory under the OS temp root,
 * removed in a scope finalizer. Shared `mkdtemp` + `acquireRelease` + `rm`
 * scaffold for `copyFixtureProject` and `makeTempBundle`; macOS temp
 * directories resolve through `/private/var`, so every path a test compares
 * against the returned root must go through the same `realpath` call (or
 * prefix matching silently fails).
 *
 * @public
 */
export const acquireTempDir = (prefix: string): Effect.Effect<string, never, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), prefix)))),
		(root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
	);
