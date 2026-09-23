import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Scope } from "effect";
import { Effect } from "effect";

/**
 * Writes `files` (bundle-relative path -> content) into a fresh temp
 * directory and removes it in a scope finalizer. For tests that need a
 * small, hand-crafted bundle rather than the shared fixture project (for
 * example a CRLF source or a multi-byte character at a specific offset).
 *
 * @public
 */
export const makeTempBundle = (
	files: Readonly<Record<string, string>>,
): Effect.Effect<{ readonly root: string }, never, Scope.Scope> =>
	Effect.acquireRelease(
		Effect.promise(async () => {
			const root = await mkdtemp(join(tmpdir(), "okfit-lsp-locate-"));
			for (const [relative, content] of Object.entries(files)) {
				const target = join(root, relative);
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, content, "utf8");
			}
			return { root };
		}),
		({ root }) => Effect.promise(() => rm(root, { recursive: true, force: true })),
	);
