import { confineReal } from "@effected/walker";
import type { LoadedBundle } from "@okfit/core";
import { Derive } from "@okfit/core";
import { Effect, FileSystem, Path } from "effect";
import type { PendingWrite } from "./write.js";
import { writeAtomic } from "./write.js";

/** @internal */
export interface SyncIndexResult {
	readonly selected: true;
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: "symlink-escape" }>;
}

/**
 * OKF 0.3 section 3.2: a consumer does not follow a symbolic link out of the bundle. `Bundle.load` records
 * `symlink-escape` on a link that resolves outside the root and drops it, so a load diagnostic answers first.
 * The walker never lists a DANGLING link, so it has no diagnostic and no `files` entry; `lstat` plus `confineReal`
 * (the rule `Bundle.load` applies) decides every other case. A reserved `index.md` or `log.md` that escapes is
 * never read and never written, in any mode.
 *
 * @internal
 */
export const escapesBundle = Effect.fn("okfit/sync/escapesBundle")(function* (bundle: LoadedBundle, relative: string) {
	if (bundle.diagnostics.some((entry) => entry.code === "symlink-escape" && entry.file === relative)) return true;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const target = path.join(bundle.root, relative);
	const link = yield* fs.lstat(target).pipe(
		Effect.map((info) => info as FileSystem.File.Info | undefined),
		Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
	);
	if (link === undefined || link.type !== "SymbolicLink") return false;
	return yield* confineReal(bundle.root, target).pipe(Effect.match({ onFailure: () => true, onSuccess: () => false }));
});

/**
 * Immediate child directories of `dir`, unioned from `bundle.directories`
 * and `bundle.indexes.keys()` -- the same union `Derive.synthesizeIndex`
 * walks (S-29, amending S-20's wording): a directory holding only an
 * `index.md` and no concepts is never a member of `bundle.directories`
 * (`Bundle.load` records a directory there only when it holds a concept),
 * but it is still a key of `bundle.indexes`, so omitting that map would
 * silently drop it from the root's `# Subdirectories` section while every
 * other directory's own `synthesizeIndex` call still lists it as a child.
 */
const childDirectoriesOf = (bundle: LoadedBundle, dir: string): ReadonlyArray<string> => {
	const prefix = dir === "" ? "" : `${dir}/`;
	const children = new Set<string>();
	for (const candidate of [...bundle.directories, ...bundle.indexes.keys()]) {
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
	pending?: Array<PendingWrite>,
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
		pending?.push({ target: targetPath, contents: rendered });
		written.push(relativeId);
		return;
	}
	yield* writeAtomic(targetPath, rendered);
	written.push(relativeId);
});

/**
 * Contract §7. The root index keeps its existing frontmatter verbatim (D6);
 * `okfVersion` (the config's `okf_version`) only fills a root index that declares none; absent, nothing is added.
 *
 * Directories: the bundle root plus every directory in
 * `Derive.indexDirectories` -- each directory holding a concept and its
 * ancestors, which a parent index links to (S-20, amended: an ancestor with
 * no concept of its own still gets its index). A directory with an
 * `index.md` but no concepts is left untouched (design §4: "nothing to
 * derive") because such a directory is never a member of
 * `bundle.directories` in the first place (`Bundle.load` only records a
 * directory there when it holds a concept -- `Bundle.ts:301-323`).
 *
 * @internal
 */
export const syncIndex = Effect.fn("okfit/sync/syncIndex")(function* (
	bundle: LoadedBundle,
	dryRun: boolean,
	pending?: Array<PendingWrite>,
	okfVersion?: string,
) {
	const path = yield* Path.Path;
	const written: Array<string> = [];
	const unchanged: Array<string> = [];
	const skipped: Array<{ readonly id: string; readonly reason: "symlink-escape" }> = [];

	// Step 1: the root.
	if (yield* escapesBundle(bundle, "index.md")) skipped.push({ id: "index.md", reason: "symlink-escape" });
	else {
		const rootConcepts = [...bundle.concepts.values()].filter((concept) => !concept.path.includes("/"));
		const rootFrontmatter = bundle.indexes.get("")?.frontmatter;
		const rootRendered = Derive.renderIndex("", rootConcepts, {
			...(okfVersion === undefined ? {} : { okfVersion }),
			...(rootFrontmatter === undefined ? {} : { frontmatter: rootFrontmatter }),
			subdirectories: childDirectoriesOf(bundle, ""),
		});
		yield* writeOrCompare(
			path.join(bundle.root, "index.md"),
			"index.md",
			rootRendered,
			dryRun,
			written,
			unchanged,
			pending,
		);
	}

	// Step 2: every other directory.
	for (const dir of Derive.indexDirectories(bundle)) {
		if (dir === "") continue;
		if (yield* escapesBundle(bundle, `${dir}/index.md`)) {
			skipped.push({ id: `${dir}/index.md`, reason: "symlink-escape" });
			continue;
		}
		const rendered = Derive.synthesizeIndex(bundle, dir);
		yield* writeOrCompare(
			path.join(bundle.root, dir, "index.md"),
			`${dir}/index.md`,
			rendered,
			dryRun,
			written,
			unchanged,
			pending,
		);
	}

	// Step 3 (dry-run) is folded into writeOrCompare above: the
	// written/unchanged classification is identical either way, only the
	// actual file write is skipped.
	return { selected: true, written, unchanged, skipped } satisfies SyncIndexResult;
});
