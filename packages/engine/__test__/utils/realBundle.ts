import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";
import type { Digest } from "effect/crypto";
import { TestPlatform } from "./platform.js";

/**
 * Writes `files` (relative path -> text, bytes exact) under a fresh real temp directory, runs `use` with that
 * directory as the bundle root on the live Node platform, then removes the directory.
 */
export const withRealBundle = <A, E>(
	files: Record<string, string>,
	use: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Digest.Digest>,
) =>
	Effect.gen(function* () {
		const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-sync-bom-")));
		return yield* Effect.gen(function* () {
			for (const [name, text] of Object.entries(files)) {
				yield* Effect.promise(async () => {
					await mkdir(join(root, name, ".."), { recursive: true });
					await writeFile(join(root, name), text);
				});
			}
			return yield* use(root);
		}).pipe(Effect.ensuring(Effect.promise(() => rm(root, { recursive: true, force: true }))));
	}).pipe(Effect.provide(TestPlatform));
