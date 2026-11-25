import { posix } from "node:path";
import { MarkdownEdit } from "@effected/markdown";
import { relativeWithin } from "@effected/walker";
import type { BundleLoadError, LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle, ConceptId } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import type { DateTime, PlatformError } from "effect";
import { Effect, FileSystem, Option, Path } from "effect";
import type { Digest } from "effect/crypto";
import { rerecordBodyDigest } from "../edits/bodyDigest.js";
import type { TargetResolutionError } from "../errors.js";
import { MoveError } from "../errors.js";
import { keyRenamesFor, legacyIntegrity } from "../sync/legacyKeys.js";
import { bomOf, writeAtomic } from "../sync/write.js";
import { Targets } from "../targets/resolve.js";
import { referencesOf, rewriteReference } from "./references.js";
import { readMarkdownSources } from "./sources.js";

/**
 * What `okfit mv` will do. `from` and `to` are bundle-relative `.md` paths, `fromPath` and `toPath`
 * their absolute forms. `edits` holds the post-move path, the edit count and the full new text of
 * every file that changes, the moved file always among them (`count` may be 0). `drifts` lists the
 * ids (the moved file by its old id) whose human verification is `current` now and whose text changes, plus an
 * edited concept whose recorded body digest could not be re-recorded (its integrity block has a layout that is never
 * edited), even when no human verified it. Each `text` is the exact bytes written, a leading byte-order mark the file had
 * included; an edited concept's `x-okfit-integrity.generated.body` is re-recorded only when it matched the body before the
 * move, so the next sync keeps `generated.at`. A digest already stale, an absent one (a concept that records only
 * `generated.body_sha256` included) and a concept still on old key names are not re-recorded: the next sync then re-stamps `generated.at`, or reports the
 * concept when it cannot edit its frontmatter (both key spellings present, or an integrity block in a layout it does not
 * edit; `sync` skips those as `legacy-key-conflict` and `integrity-unsupported`).
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

/**
 * The destination's bundle-relative path (R5'): the cwd-relative path (inside the bundle) or the id
 * (a leading `/` tolerated). A destination naming an existing bundle directory, or ending in `/`,
 * means "into that directory, keeping the source's basename". Every candidate must lie inside the
 * bundle; `undefined` when none does.
 */
const resolveDestination = Effect.fn("okfit/move/destination")(function* (
	to: string,
	cwd: string,
	bundle: LoadedBundle,
	sourcePath: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const realOr = (absolute: string) => fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
	const root = yield* realOr(bundle.root);
	/**
	 * Bundle-relative posix path of `absolute` (`""` for the root itself), resolved physically through
	 * its deepest existing ancestor, since the destination does not exist yet (`@effected/walker`'s
	 * `relativeWithin`); `undefined` outside the bundle or when containment cannot be proved.
	 */
	const within = (absolute: string) => Effect.map(relativeWithin(root, absolute), Option.getOrUndefined);
	const exists = (absolute: string) => fs.exists(absolute).pipe(Effect.orElseSucceed(() => false));
	const isDirectory = (absolute: string) =>
		fs.stat(absolute).pipe(
			Effect.map((info) => info.type === "Directory"),
			Effect.orElseSucceed(() => false),
		);
	const trailingSlash = /\/$/.test(to);
	const spelled = trailingSlash ? to.replace(/\/+$/, "") : to;
	const base = posix.basename(sourcePath);

	const underCwd = path.isAbsolute(spelled) ? spelled : path.resolve(cwd, spelled);
	const cwdPath = yield* within(underCwd);
	// A cwd reading that is lexically inside the bundle but really leads out (a symlinked directory)
	// is refused outright; the id-reading fallback is only for spellings that are not bundle paths.
	const lexicalInside = (base: string) => {
		const relative = path.relative(base, underCwd);
		return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
	};
	if (cwdPath === undefined && (lexicalInside(root) || lexicalInside(bundle.root))) return undefined;
	// The id reading: posix-normalised so `..` cannot slip through, a leading `/` tolerated. For an
	// absolute destination it applies only when the path is not a real location (its top directory
	// does not exist), so `/tmp/x/outside` stays outside the bundle.
	const idReadable = path.isAbsolute(spelled)
		? cwdPath === undefined &&
			!(yield* exists(path.join(path.parse(spelled).root, spelled.split("/").find((s) => s !== "") ?? "")))
		: true;
	const idPath = yield* Effect.gen(function* () {
		if (!idReadable) return undefined;
		const id = Option.getOrUndefined(ConceptId.normalize(spelled));
		if (id === undefined) return undefined;
		// Resolve through the deepest existing ancestor so a symlinked directory cannot lead out.
		return yield* within(path.join(root, posix.normalize(id)));
	});
	// Into a directory: it exists in the bundle under either reading, or the destination ends in `/`.
	const dirs = [cwdPath, idPath].filter((candidate): candidate is string => candidate !== undefined);
	const existingDir = yield* Effect.findFirst(dirs, (candidate) => isDirectory(path.join(root, candidate)));
	if (Option.isSome(existingDir)) return posix.join(existingDir.value, base);
	const parentExists = (candidate: string | undefined) =>
		candidate === undefined ? Effect.succeed(false) : exists(path.join(root, posix.dirname(candidate)));
	if (trailingSlash) {
		const pick = (yield* parentExists(cwdPath === undefined ? undefined : `${cwdPath}/x`))
			? cwdPath
			: (yield* parentExists(idPath === undefined ? undefined : `${idPath}/x`))
				? idPath
				: (cwdPath ?? idPath);
		return pick === undefined ? undefined : posix.join(pick, base);
	}

	const withExt = (candidate: string | undefined) => (candidate === undefined ? undefined : withMd(candidate));
	const cwdCandidate = withExt(cwdPath);
	const idCandidate = withExt(idPath);
	if (cwdCandidate === "" || idCandidate === "") return undefined;
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
): Effect.fn.Return<MovePlan, PlanError, FileSystem.FileSystem | Path.Path | Digest.Digest> {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const [source] = yield* Targets.resolve([options.from], bundle, options.cwd);
	if (source === undefined) return yield* new MoveError({ reason: "same-path" });
	// The root Project concept (the profile layout's project file) must stay at the bundle root.
	if (source.path === "project.md") return yield* new MoveError({ reason: "project-file", detail: source.path });
	if (/\s/.test(options.to)) return yield* new MoveError({ reason: "invalid-name", detail: options.to });
	const destination = yield* resolveDestination(options.to, options.cwd, bundle, source.path);
	if (destination === undefined) return yield* new MoveError({ reason: "outside-bundle", detail: options.to });
	if (ConceptId.isReservedFile(destination)) return yield* new MoveError({ reason: "reserved", detail: destination });
	if (destination === source.path) return yield* new MoveError({ reason: "same-path" });
	const toAbsolute = path.join(bundle.root, destination);
	const taken =
		bundle.files.includes(destination) || (yield* fs.exists(toAbsolute).pipe(Effect.orElseSucceed(() => false)));
	if (taken) return yield* new MoveError({ reason: "destination-exists", detail: destination });

	// Markdown the bundle holds but did not load as a concept: scanned like a concept body, unless the file cannot
	// be read at all (unclosed or unparseable frontmatter), which refuses the move.
	const { sources: nonConcepts, unreadable } = yield* readMarkdownSources(bundle, { reserved: false });
	if (unreadable.length > 0) return yield* new MoveError({ reason: "unloaded-files", detail: unreadable.join("\n") });

	const found = [
		...[...bundle.concepts.values()].map((concept) => ({
			concept,
			isConcept: true as const,
			...referencesOf(concept, options.config),
		})),
		...nonConcepts.map((concept) => ({ concept, isConcept: false as const, ...referencesOf(concept, options.config) })),
	];
	// Only a reference that would need rewriting (it sits in the moved file, or resolves to it) can
	// block the move; an unrelated link the locator cannot read is left alone.
	const unlocatable = found.flatMap(({ concept, unlocatableRefs }) =>
		unlocatableRefs
			.filter(
				(missing) =>
					concept.path === source.path ||
					rewriteReference(missing.raw, {
						bundle,
						fromOld: concept.path,
						fromNew: concept.path,
						movedFrom: source.path,
						movedTo: destination,
						...(missing.field === undefined ? {} : { field: missing.field }),
					}) !== undefined,
			)
			.map((missing) => missing.entry),
	);
	// A rewritten path that holds whitespace is only valid Markdown inside angle brackets.
	for (const { concept, references } of found) {
		for (const reference of references) {
			const next = rewriteReference(reference.raw, {
				bundle,
				fromOld: concept.path,
				fromNew: concept.path === source.path ? destination : concept.path,
				movedFrom: source.path,
				movedTo: destination,
				...(reference.field === undefined ? {} : { field: reference.field }),
				...(reference.angle === true ? { angle: true } : {}),
			});
			if (next !== undefined && /\s/.test(next) && reference.angle !== true)
				unlocatable.push(`${concept.path}: ${reference.raw}`);
		}
	}
	if (unlocatable.length > 0) return yield* new MoveError({ reason: "unrewritable", detail: unlocatable.join("\n") });

	const signals = yield* Trust.signals(bundle, options.config, options.now);
	const edits: Array<{ path: string; count: number; text: string }> = [];
	const drifts = new Set<string>();
	const renames = keyRenamesFor(options.config);
	for (const { concept, isConcept, references } of found) {
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
				...(reference.angle === true ? { angle: true } : {}),
			});
			if (next !== undefined)
				pending.push(MarkdownEdit.make({ offset: reference.offset, length: reference.length, content: next }));
		}
		if (pending.length === 0 && !isMoved) continue;
		let text = pending.length === 0 ? concept.document.source : MarkdownEdit.applyAll(concept.document.source, pending);
		const id = concept.path.slice(0, -3);
		// A link-only edit leaves the recorded body digest stale, and the next sync would read that as an authored
		// change and re-stamp `generated.at`: re-record it when it matched. A concept on old key names is left to
		// sync (it renames the keys first); a layout that cannot be edited is listed instead.
		if (isConcept && pending.length > 0 && legacyIntegrity(concept, renames) === undefined) {
			const kept = yield* rerecordBodyDigest({
				recorded: concept.frontmatter.integrity?.generated?.body,
				before: concept.document.source,
				after: text,
			});
			text = kept.text;
			if (kept.outcome === "unrecordable") drifts.add(id);
		}
		// The loader reads through `readFileString`, which drops a leading BOM; give back the one the file had.
		const bom = yield* bomOf(fs, path.join(bundle.root, concept.path));
		edits.push({ path: fromNew, count: pending.length, text: bom + text });
		if (isConcept && pending.length > 0 && signals.get(id)?.integrity === "current") drifts.add(id);
	}
	edits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return {
		from: source.path,
		to: destination,
		fromPath: path.join(bundle.root, source.path),
		toPath: toAbsolute,
		edits,
		drifts: [...drifts].sort(),
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
	FileSystem.FileSystem | Path.Path | Digest.Digest
> {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const plan = yield* planMove(options);
	if (!options.dryRun) {
		// Create the destination directory first: if it cannot be made, nothing has been written yet.
		yield* fs.makeDirectory(path.dirname(plan.toPath), { recursive: true });
		for (const edit of plan.edits) {
			if (edit.path === plan.to) continue;
			yield* writeAtomic(path.join(options.bundleRoot, edit.path), edit.text);
		}
		const moved = plan.edits.find((edit) => edit.path === plan.to);
		if (moved !== undefined) yield* writeAtomic(plan.fromPath, moved.text);
		yield* fs.rename(plan.fromPath, plan.toPath);
	}
	return { plan, bundleRoot: options.bundleRoot, dryRun: options.dryRun };
});
