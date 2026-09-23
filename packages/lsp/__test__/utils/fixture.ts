import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Scope } from "effect";
import { Effect } from "effect";
import { acquireTempDir } from "./tempDir.js";

/** `__test__/fixtures/project`, resolved relative to this file rather than `process.cwd()`. */
const FIXTURE_ROOT = fileURLToPath(new URL("../fixtures/project", import.meta.url));

/**
 * Copies `__test__/fixtures/project` into a fresh, `realpath`-resolved temp
 * directory (`acquireTempDir`) and removes it in a scope finalizer.
 *
 * @public
 */
export const copyFixtureProject = (): Effect.Effect<{ readonly root: string }, never, Scope.Scope> =>
	Effect.gen(function* () {
		const root = yield* acquireTempDir("okfit-lsp-");
		yield* Effect.promise(() => cp(FIXTURE_ROOT, root, { recursive: true }));
		return { root };
	});
