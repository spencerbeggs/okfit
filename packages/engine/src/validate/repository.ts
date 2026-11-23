import type { DiagnosticSeverity, LoadedBundle, LoadedConcept } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfVersion } from "@okfit/core";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";

/**
 * Where a resource candidate lies: inside the bundle (OKF's own resolution) or
 * inside the project root but outside the bundle (okfit's repository check,
 * which OKF 0.3 §6 does not define).
 *
 * @public
 */
export type ResourceScope = "bundle" | "repository";

/**
 * One absolute path a `resource` value may name, classified by {@link ResourceScope}.
 *
 * @public
 */
export interface ResourceCandidate {
	readonly absolute: string;
	readonly scope: ResourceScope;
}

/** Strips a trailing `#fragment` or `?query` suffix before filesystem resolution. */
export const stripSuffix = (value: string): string => {
	const at = value.search(/[?#]/);
	return at === -1 ? value : value.slice(0, at);
};

/**
 * Lexical containment: true when `absolute` is `root` or lies under it. Purely textual, so a symlink
 * inside `root` that points out of it still passes; callers that touch the disk also check the real path.
 *
 * @public
 */
export const withinRoot = (root: string, absolute: string, path: Path.Path): boolean => {
	const rel = path.relative(root, absolute);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

/**
 * The absolute candidates a literal `resource` value may resolve to, in OKF 0.3 §6 order: a leading `/`
 * names the bundle root only; otherwise the file-relative path, then the bundle root for a bare value when
 * the bundle still allows the v0.2 fallbacks. Each candidate is `bundle` when lexically inside `bundle.root`,
 * `repository` when inside `projectRoot` but not the bundle, and dropped when outside `projectRoot`, so an
 * empty result for a non-descriptor means the value points outside the project and must never be touched.
 * The caller has already ruled out descriptors.
 *
 * @public
 */
export const resourceCandidates = (input: {
	readonly bundle: LoadedBundle;
	readonly concept: LoadedConcept;
	readonly value: string;
	readonly projectRoot: string;
	readonly path: Path.Path;
}): ReadonlyArray<ResourceCandidate> => {
	const { bundle, concept, value, projectRoot, path } = input;
	const stripped = stripSuffix(value);
	const absolutes = stripped.startsWith("/")
		? [path.join(bundle.root, stripped.slice(1))]
		: [
				path.resolve(bundle.root, path.dirname(concept.path), stripped),
				...(!(stripped.startsWith("./") || stripped.startsWith("../")) && OkfVersion.legacyFallbacks(bundle)
					? [path.resolve(bundle.root, stripped)]
					: []),
			];
	const candidates: Array<ResourceCandidate> = [];
	for (const absolute of absolutes) {
		if (withinRoot(bundle.root, absolute, path)) candidates.push({ absolute, scope: "bundle" });
		else if (withinRoot(projectRoot, absolute, path)) candidates.push({ absolute, scope: "repository" });
	}
	return candidates;
};

/** `realPath`, or `undefined` when nothing exists there; any other failure stays in the channel. */
const realOrUndefined = (
	fs: FileSystem.FileSystem,
	target: string,
): Effect.Effect<string | undefined, PlatformError.PlatformError> =>
	fs.realPath(target).pipe(
		Effect.catchIf(
			(error) => error.reason._tag === "NotFound",
			() => Effect.succeed(undefined),
		),
	);

/**
 * The real path of `absolute`, or `undefined` when nothing exists there. A path `realPath` cannot see but
 * `lstat` can is a document that lives only in the editor overlay (the overlay shadows `lstat`, not `realPath`):
 * it counts, at its parent's real path, unless it is a symlink, which `realPath` could not follow (dangling).
 */
const realOf = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	absolute: string,
): Effect.Effect<string | undefined, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		const real = yield* realOrUndefined(fs, absolute);
		if (real !== undefined) return real;
		const parent = yield* realOrUndefined(fs, path.dirname(absolute));
		if (parent === undefined) return undefined;
		const info = yield* fs.lstat(absolute).pipe(
			Effect.catchIf(
				(error) => error.reason._tag === "NotFound",
				() => Effect.succeed(undefined),
			),
		);
		return info === undefined || info.type === "SymbolicLink" ? undefined : path.join(parent, path.basename(absolute));
	});

/**
 * Where a literal `resource` value ended up: `found` (a real path inside the project), `outside` (it, or the
 * symlink it goes through, leaves the project root; nothing beyond containment was read), or `missing`.
 *
 * @public
 */
export type ResourceLocation =
	| { readonly _tag: "found"; readonly absolute: string; readonly real: string }
	| { readonly _tag: "outside" }
	| { readonly _tag: "missing" };

/**
 * Resolves a literal `resource` value to a real path inside the project, trying each candidate in order.
 * The only filesystem call made on a candidate is `realPath` of the candidate itself, and a candidate whose
 * real path leaves the real project root (and the real bundle root) is never `exists`ed, `stat`ed or read: a
 * symlink inside the project that points out of it is reported `outside`. A value with no in-project
 * candidate is `outside` without touching the filesystem at all.
 *
 * @public
 */
export const locateResource = (input: {
	readonly bundle: LoadedBundle;
	readonly concept: LoadedConcept;
	readonly value: string;
	readonly projectRoot: string;
}): Effect.Effect<ResourceLocation, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const candidates = resourceCandidates({ ...input, path });
		if (candidates.length === 0) return { _tag: "outside" } as const;
		const realRoots: Array<string> = [];
		for (const root of [input.projectRoot, input.bundle.root]) {
			realRoots.push((yield* realOrUndefined(fs, root)) ?? root);
		}
		let escaped = false;
		for (const candidate of candidates) {
			const real = yield* realOf(fs, path, candidate.absolute);
			if (real === undefined) continue;
			if (!realRoots.some((root) => withinRoot(root, real, path))) {
				escaped = true;
				continue;
			}
			return { _tag: "found", absolute: candidate.absolute, real } as const;
		}
		return escaped ? ({ _tag: "outside" } as const) : ({ _tag: "missing" } as const);
	});

/**
 * The `resource-outside-project` diagnostic for one value, ranged at its frontmatter path. okfit's own
 * repository check, not OKF: the value is reported from its text alone.
 *
 * @public
 */
export const outsideProjectDiagnostic = (
	concept: LoadedConcept,
	value: string,
	fieldPath: ReadonlyArray<string | number>,
	severity: DiagnosticSeverity,
): Diagnostic => {
	const range = DiagnosticRange.forFrontmatterPath(concept.document, fieldPath);
	return Diagnostic.make({
		file: concept.path,
		code: "resource-outside-project",
		severity,
		message: `Resource "${value}" resolves outside the project root; okfit does not read it`,
		...(range === undefined ? {} : { range }),
	});
};
