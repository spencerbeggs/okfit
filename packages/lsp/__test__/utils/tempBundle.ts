import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Scope } from "effect";
import { Effect } from "effect";
import { acquireTempDir } from "./tempDir.js";

/**
 * Writes `files` (bundle-relative path -> content) into a fresh temp
 * directory (`acquireTempDir`) and removes it in a scope finalizer. For
 * tests that need a small, hand-crafted bundle rather than the shared
 * fixture project (for example a CRLF source or a multi-byte character at a
 * specific offset).
 *
 * @public
 */
export const makeTempBundle = (
	files: Readonly<Record<string, string>>,
): Effect.Effect<{ readonly root: string }, never, Scope.Scope> =>
	Effect.gen(function* () {
		const root = yield* acquireTempDir("okfit-lsp-locate-");
		yield* Effect.promise(async () => {
			for (const [relative, content] of Object.entries(files)) {
				const target = join(root, relative);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content, "utf8");
			}
		});
		return { root };
	});
