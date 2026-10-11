import { posix } from "node:path";
import type { LoadedBundle } from "@okfit/core";
import { ConceptId } from "@okfit/core";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path } from "effect";
import type { TargetFailure as TargetFailureType } from "../errors.js";
import { TargetResolutionError } from "../errors.js";

/**
 * One resolved concept target: the argument as typed, the bundle-relative
 * posix file path, and the concept id (absent only for a non-concept file
 * accepted under `files: true`).
 *
 * @public
 */
export interface ResolvedTarget {
	readonly arg: string;
	readonly path: string;
	readonly id: ConceptId | undefined;
}

type Hit = { readonly path: string } | { readonly failure: TargetFailureType["reason"] } | undefined;

const levenshtein = (a: string, b: string): number => {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let previous = row[0] ?? 0;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const current = row[j] ?? 0;
			row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
			previous = current;
		}
	}
	return row[b.length] ?? 0;
};

const suggest = (arg: string, bundle: LoadedBundle): string | undefined => {
	const wanted = Option.getOrUndefined(ConceptId.normalize(arg));
	if (wanted === undefined) return undefined;
	const ids = [...bundle.concepts.keys()].sort();
	const base = posix.basename(wanted);
	const byBase = ids.filter((id) => posix.basename(id) === base);
	if (byBase.length === 1) return byBase[0];
	const limit = Math.max(2, Math.floor(wanted.length / 3));
	let best: { id: string; distance: number } | undefined;
	for (const id of ids) {
		const distance = levenshtein(wanted, id);
		if (distance <= limit && (best === undefined || distance < best.distance)) best = { id, distance };
	}
	return best?.id;
};

const withSuggestion = (arg: string, bundle: LoadedBundle): TargetFailureType => {
	const suggestion = suggest(arg, bundle);
	return suggestion === undefined ? { arg, reason: "not-found" } : { arg, reason: "not-found", suggestion };
};

/** Bundle-relative posix path of `absolute`, or `undefined` when it lies outside `root`. */
const inside = (path: Path.Path, root: string, absolute: string): string | undefined => {
	const relative = path.relative(root, absolute);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
	return relative.split(path.sep).join("/");
};

const resolve = Effect.fn("okfit/targets/resolve")(function* (
	args: ReadonlyArray<string>,
	bundle: LoadedBundle,
	cwd: string,
	options?: { readonly files?: boolean },
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const files = new Set(bundle.files);
	const acceptFiles = options?.files === true;
	const realOr = (absolute: string) => fs.realPath(absolute).pipe(Effect.orElseSucceed(() => absolute));
	const root = yield* realOr(bundle.root);

	/** A bundle-relative file path that names a target, or why it does not. */
	const classify = (relative: string): Hit => {
		if (!files.has(relative)) return undefined;
		if (acceptFiles) return { path: relative };
		if (ConceptId.isReservedFile(relative)) return { failure: "reserved" };
		const id = Option.getOrUndefined(ConceptId.fromPath(relative));
		return id !== undefined && bundle.concepts.has(id) ? { path: relative } : { failure: "not-a-concept" };
	};

	/** A filesystem candidate (absolute or cwd-relative): only an existing file inside the bundle counts. */
	const onDisk = (absolute: string) =>
		Effect.gen(function* () {
			if (!(yield* fs.exists(absolute).pipe(Effect.orElseSucceed(() => false)))) {
				return { outside: false, hit: undefined as Hit };
			}
			const relative = inside(path, root, yield* realOr(absolute));
			return relative === undefined
				? { outside: true, hit: undefined as Hit }
				: { outside: false, hit: classify(relative) };
		});

	const resolved: Array<ResolvedTarget> = [];
	const failures: Array<TargetFailureType> = [];
	const seen = new Set<string>();
	const accept = (arg: string, relative: string) => {
		if (seen.has(relative)) return;
		seen.add(relative);
		const id = Option.getOrUndefined(ConceptId.fromPath(relative));
		resolved.push({ arg, path: relative, id: id !== undefined && bundle.concepts.has(id) ? id : undefined });
	};

	for (const arg of args) {
		// Step 1 (absolute) or 2 (cwd-relative): only an existing file inside the bundle counts.
		const fromDisk = yield* onDisk(path.isAbsolute(arg) ? arg : path.resolve(cwd, arg));
		// Step 3: a bundle-relative id, a leading "/" and trailing ".md" tolerated.
		const id = Option.getOrUndefined(ConceptId.normalize(arg.replace(/^\/+/, "")));
		const byId = id === undefined ? undefined : classify(ConceptId.toPath(id));
		const diskPath = fromDisk.hit !== undefined && "path" in fromDisk.hit ? fromDisk.hit.path : undefined;
		const idPath = byId !== undefined && "path" in byId ? byId.path : undefined;
		if (diskPath !== undefined && idPath !== undefined && diskPath !== idPath && !path.isAbsolute(arg)) {
			failures.push({ arg, reason: "ambiguous", candidates: [diskPath, idPath] });
		} else if (diskPath !== undefined) accept(arg, diskPath);
		else if (idPath !== undefined) accept(arg, idPath);
		else if (fromDisk.hit !== undefined && "failure" in fromDisk.hit)
			failures.push({ arg, reason: fromDisk.hit.failure });
		else if (byId !== undefined && "failure" in byId) failures.push({ arg, reason: byId.failure });
		else failures.push(fromDisk.outside ? { arg, reason: "outside-bundle" } : withSuggestion(arg, bundle));
	}
	if (failures.length > 0) return yield* new TargetResolutionError({ failures });
	return resolved as ReadonlyArray<ResolvedTarget>;
});

/**
 * Concept targets on the CLI (spec section 13): the shared resolver every
 * concept command calls before it reads or writes anything. Resolution order
 * is absolute path, cwd-relative path, then bundle-relative id; a candidate
 * outside the bundle is discarded, never matched. With `files: true` any
 * walked bundle file is accepted, so a reserved or undecodable file can still
 * be validated.
 *
 * @public
 */
export class Targets {
	private constructor() {}
	/** Resolve every argument or fail with every bad one; duplicates collapse to the first spelling. */
	static readonly resolve: (
		args: ReadonlyArray<string>,
		bundle: LoadedBundle,
		cwd: string,
		options?: { readonly files?: boolean },
	) => Effect.Effect<
		ReadonlyArray<ResolvedTarget>,
		TargetResolutionError | PlatformError.PlatformError,
		FileSystem.FileSystem | Path.Path
	> = resolve;
	/** The nearest concept id to `arg`: a unique basename match first, else the closest by edit distance. */
	static readonly suggest: (arg: string, bundle: LoadedBundle) => string | undefined = suggest;
}
