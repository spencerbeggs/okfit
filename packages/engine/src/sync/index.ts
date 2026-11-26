import type { LoadedBundle } from "@okfit/core";
import { Derive } from "@okfit/core";
import { Effect, FileSystem, Path } from "effect";
import { escapesBundle } from "../confinement.js";
import type { PendingWrite } from "./write.js";
import { readOptionalSplittingBom, toLf, withNewline, writeAtomic } from "./write.js";

/** @internal */
export interface SyncIndexResult {
	readonly selected: true;
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: "symlink-escape" | "index-unparseable" }>;
}

export { escapesBundle } from "../confinement.js";

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

/** An `index.md` the loader found but could not read; rendering over it would erase what the author wrote (#512). */
const indexUnreadable = (bundle: LoadedBundle, file: string): boolean =>
	bundle.diagnostics.some(
		(d) => d.file === file && (d.code === "frontmatter-unclosed" || d.code === "frontmatter-unparseable"),
	);

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
	// A leading BOM and the file's line ending are kept (#492, #505): render in LF, compare on the stripped text
	// with its endings ignored (a file that differs only in endings is unchanged), and write `bom + expected`,
	// the render in the file's first newline.
	const { text: onDisk, bom, newline } = yield* readOptionalSplittingBom(fs, targetPath);
	const expected = withNewline(rendered, newline);
	if (onDisk !== undefined && toLf(onDisk) === rendered) {
		unchanged.push(relativeId);
		return;
	}
	if (dryRun) {
		pending?.push({ target: targetPath, contents: bom + expected });
		written.push(relativeId);
		return;
	}
	yield* writeAtomic(targetPath, bom + expected);
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
 * An `index.md` that exists but could not be read (unclosed or unparseable frontmatter) is skipped as
 * `index-unparseable` and never rewritten, since rendering over it would erase what the author wrote (#512). A
 * rewrite keeps the file's leading BOM and its line ending (the rule covers LF and CRLF: its first newline's, and a file with no LF is written LF, #505); a file that
 * differs from the render only in its line endings is `unchanged` and keeps its bytes.
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
	const skipped: Array<{ readonly id: string; readonly reason: "symlink-escape" | "index-unparseable" }> = [];

	// Step 1: the root.
	if (yield* escapesBundle(bundle, "index.md")) skipped.push({ id: "index.md", reason: "symlink-escape" });
	else if (indexUnreadable(bundle, "index.md")) skipped.push({ id: "index.md", reason: "index-unparseable" });
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
		if (indexUnreadable(bundle, `${dir}/index.md`)) {
			skipped.push({ id: `${dir}/index.md`, reason: "index-unparseable" });
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
