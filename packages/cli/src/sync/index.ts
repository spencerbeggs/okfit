import type { LoadedBundle } from "@okfit/core";
import { Derive, OKF_SPEC_VERSION } from "@okfit/core";
import { Effect, FileSystem, Path } from "effect";

/** @internal */
export interface SyncIndexResult {
	readonly selected: true;
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: readonly [];
}

/** Immediate child directories of `dir` among `bundle.directories` (S-20's own rule, mirroring `Derive.synthesizeIndex`'s child-directory walk). */
const childDirectoriesOf = (bundle: LoadedBundle, dir: string): ReadonlyArray<string> => {
	const prefix = dir === "" ? "" : `${dir}/`;
	const children = new Set<string>();
	for (const candidate of bundle.directories) {
		if (candidate === "" || candidate === dir || !candidate.startsWith(prefix)) continue;
		const head = candidate.slice(prefix.length).split("/")[0];
		if (head !== undefined && head !== "") children.add(head);
	}
	return [...children];
};

const writeOrCompare = Effect.fn("okfit/sync/index/writeOrCompare")(function* (
	targetPath: string,
	relativeId: string,
	rendered: string,
	dryRun: boolean,
	written: Array<string>,
	unchanged: Array<string>,
) {
	const fs = yield* FileSystem.FileSystem;
	const onDisk = yield* fs.readFileString(targetPath).pipe(
		Effect.map((text) => text as string | undefined),
		Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
	);
	if (onDisk === rendered) {
		unchanged.push(relativeId);
		return;
	}
	if (dryRun) {
		written.push(relativeId);
		return;
	}
	const tempPath = `${targetPath}.okfit-sync.tmp`;
	yield* fs.writeFileString(tempPath, rendered);
	yield* fs.rename(tempPath, targetPath);
	written.push(relativeId);
});

/**
 * Contract §7. Directories: the bundle root plus every directory in
 * `bundle.directories` that holds at least one concept -- the same set
 * `Derive.synthesizeIndex` already walks (S-20). A directory with an
 * `index.md` but no concepts is left untouched (design §4: "nothing to
 * derive") because such a directory is never a member of
 * `bundle.directories` in the first place (`Bundle.load` only records a
 * directory there when it holds a concept -- `Bundle.ts:301-323`).
 *
 * @internal
 */
export const syncIndex = Effect.fn("okfit/sync/syncIndex")(function* (bundle: LoadedBundle, dryRun: boolean) {
	const path = yield* Path.Path;
	const written: Array<string> = [];
	const unchanged: Array<string> = [];

	// Step 1: the root.
	const rootConcepts = [...bundle.concepts.values()].filter((concept) => !concept.path.includes("/"));
	const rootRendered = Derive.renderIndex("", rootConcepts, {
		okfVersion: OKF_SPEC_VERSION,
		subdirectories: childDirectoriesOf(bundle, ""),
	});
	yield* writeOrCompare(path.join(bundle.root, "index.md"), "index.md", rootRendered, dryRun, written, unchanged);

	// Step 2: every other directory.
	for (const dir of bundle.directories) {
		if (dir === "") continue;
		const rendered = Derive.synthesizeIndex(bundle, dir);
		yield* writeOrCompare(
			path.join(bundle.root, dir, "index.md"),
			`${dir}/index.md`,
			rendered,
			dryRun,
			written,
			unchanged,
		);
	}

	// Step 3 (dry-run) is folded into writeOrCompare above: the
	// written/unchanged classification is identical either way, only the
	// actual file write is skipped.
	return { selected: true, written, unchanged, skipped: [] } satisfies SyncIndexResult;
});
