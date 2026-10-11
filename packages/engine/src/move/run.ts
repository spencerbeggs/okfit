import { posix } from "node:path";
import { MarkdownEdit } from "@effected/markdown";
import type { BundleLoadError, LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle, ConceptId } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import type { Crypto, DateTime, PlatformError } from "effect";
import { Effect, FileSystem, Option, Path } from "effect";
import type { TargetResolutionError } from "../errors.js";
import { MoveError } from "../errors.js";
import { writeAtomic } from "../sync/write.js";
import { Targets } from "../targets/resolve.js";
import { referencesOf, rewriteReference } from "./references.js";

/**
 * What `okfit mv` will do. `from` and `to` are bundle-relative `.md` paths, `fromPath` and `toPath`
 * their absolute forms. `edits` holds the post-move path, the edit count and the full new text of
 * every file that changes, the moved file always among them (`count` may be 0). `drifts` lists the
 * ids (the moved file by its old id) whose human verification is `current` now and whose text changes.
 *
 * @public
 */
export interface MovePlan {
	readonly from: string;
	readonly to: string;
	readonly fromPath: string;
	readonly toPath: string;
	readonly edits: ReadonlyArray<{ readonly path: string; readonly count: number; readonly text: string }>;
	readonly drifts: ReadonlyArray<string>;
}

/** @public */
export interface PlanMoveOptions {
	/** The concept to move: a path or id, resolved like any other concept target. */
	readonly from: string;
	/** The destination: an absolute path, a cwd-relative path or a bundle-relative id; `.md` is appended when missing. */
	readonly to: string;
	readonly cwd: string;
	readonly bundleRoot: string;
	readonly config: OkfitConfig;
	readonly now: DateTime.Utc;
}

/** @public */
export interface RunMoveOptions extends PlanMoveOptions {
	readonly dryRun: boolean;
}

/** Every failure {@link planMove} and {@link runMove} can raise. @public */
export type PlanError = MoveError | TargetResolutionError | BundleLoadError | PlatformError.PlatformError;

const withMd = (value: string): string => (value.endsWith(".md") ? value : `${value}.md`);

/** The destination's bundle-relative path (R5'): the cwd-relative path (inside the bundle) or the id. */
const resolveDestination = Effect.fn("okfit/move/destination")(function* (
	to: string,
	cwd: string,
	bundle: LoadedBundle,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const realOr = (absolute: string) => fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
	/** Real path of the deepest existing ancestor, re-joined with the rest (the file does not exist yet). */
	const realish = (absolute: string): Effect.Effect<string> =>
		Effect.gen(function* () {
			const resolved = yield* fs.realPath(absolute).pipe(Effect.option);
			if (Option.isSome(resolved)) return resolved.value;
			const parent = path.dirname(absolute);
			if (parent === absolute) return absolute;
			return path.join(yield* realish(parent), path.basename(absolute));
		});
	const root = yield* realOr(bundle.root);
	const inside = (absolute: string): string | undefined => {
		const relative = path.relative(root, absolute);
		if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
		return relative.split(path.sep).join("/");
	};
	const underCwd = path.isAbsolute(to) ? to : path.resolve(cwd, to);
	const cwdCandidate = inside(yield* realish(withMd(underCwd)));
	if (path.isAbsolute(to)) return cwdCandidate;
	const id = Option.getOrUndefined(ConceptId.normalize(to));
	const idCandidate = id === undefined ? undefined : ConceptId.toPath(id);
	const parentExists = (candidate: string | undefined) =>
		candidate === undefined
			? Effect.succeed(false)
			: fs.exists(path.join(bundle.root, posix.dirname(candidate))).pipe(Effect.orElseSucceed(() => false));
	if (yield* parentExists(cwdCandidate)) return cwdCandidate;
	if (yield* parentExists(idCandidate)) return idCandidate;
	return cwdCandidate ?? idCandidate;
});

/**
 * Plan moving one concept: resolve both ends, find every reference to it across the bundle (and the
 * moved file's own outbound references), and compute the new text of each file that changes. Pure of
 * writes; refuses with {@link MoveError} when the destination is unusable or any body link cannot be
 * located for rewriting.
 *
 * @public
 */
export const planMove = Effect.fn("okfit/move/plan")(function* (
	options: PlanMoveOptions,
): Effect.fn.Return<MovePlan, PlanError, FileSystem.FileSystem | Path.Path | Crypto.Crypto> {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const [source] = yield* Targets.resolve([options.from], bundle, options.cwd);
	if (source === undefined) return yield* new MoveError({ reason: "same-path" });
	const destination = yield* resolveDestination(options.to, options.cwd, bundle);
	if (destination === undefined) return yield* new MoveError({ reason: "outside-bundle", detail: options.to });
	if (ConceptId.isReservedFile(destination)) return yield* new MoveError({ reason: "reserved", detail: destination });
	if (destination === source.path) return yield* new MoveError({ reason: "same-path" });
	const toAbsolute = path.join(bundle.root, destination);
	const taken =
		bundle.files.includes(destination) || (yield* fs.exists(toAbsolute).pipe(Effect.orElseSucceed(() => false)));
	if (taken) return yield* new MoveError({ reason: "destination-exists", detail: destination });

	const found = [...bundle.concepts.values()].map((concept) => ({
		concept,
		...referencesOf(concept, options.config),
	}));
	const unlocatable = found.flatMap((entry) => entry.unlocatable);
	if (unlocatable.length > 0) return yield* new MoveError({ reason: "unrewritable", detail: unlocatable.join("\n") });

	const signals = yield* Trust.signals(bundle, options.config, options.now);
	const edits: Array<{ path: string; count: number; text: string }> = [];
	const drifts: Array<string> = [];
	for (const { concept, references } of found) {
		const isMoved = concept.path === source.path;
		const fromNew = isMoved ? destination : concept.path;
		const pending: Array<MarkdownEdit> = [];
		for (const reference of references) {
			const next = rewriteReference(reference.raw, {
				bundle,
				fromOld: concept.path,
				fromNew,
				movedFrom: source.path,
				movedTo: destination,
				...(reference.field === undefined ? {} : { field: reference.field }),
			});
			if (next !== undefined)
				pending.push(MarkdownEdit.make({ offset: reference.offset, length: reference.length, content: next }));
		}
		if (pending.length === 0 && !isMoved) continue;
		const text =
			pending.length === 0 ? concept.document.source : MarkdownEdit.applyAll(concept.document.source, pending);
		edits.push({ path: fromNew, count: pending.length, text });
		if (pending.length > 0 && signals.get(concept.path.slice(0, -3))?.integrity === "current")
			drifts.push(concept.path.slice(0, -3));
	}
	edits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	drifts.sort();
	return {
		from: source.path,
		to: destination,
		fromPath: path.join(bundle.root, source.path),
		toPath: toAbsolute,
		edits,
		drifts,
	};
});

/**
 * Plan the move, then (unless `dryRun`) write it: every referrer atomically, the moved file's new
 * text over its old path, then a rename to the destination (its directory created first). Nothing is
 * written until the whole plan succeeded; the writes themselves are not transactional (the rename is last).
 *
 * @public
 */
export const runMove = Effect.fn("okfit/move/run")(function* (
	options: RunMoveOptions,
): Effect.fn.Return<
	{ readonly plan: MovePlan; readonly bundleRoot: string; readonly dryRun: boolean },
	PlanError,
	FileSystem.FileSystem | Path.Path | Crypto.Crypto
> {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const plan = yield* planMove(options);
	if (!options.dryRun) {
		for (const edit of plan.edits) {
			if (edit.path === plan.to) continue;
			yield* writeAtomic(path.join(options.bundleRoot, edit.path), edit.text);
		}
		const moved = plan.edits.find((edit) => edit.path === plan.to);
		if (moved !== undefined) yield* writeAtomic(plan.fromPath, moved.text);
		yield* fs.makeDirectory(path.dirname(plan.toPath), { recursive: true });
		yield* fs.rename(plan.fromPath, plan.toPath);
	}
	return { plan, bundleRoot: options.bundleRoot, dryRun: options.dryRun };
});
