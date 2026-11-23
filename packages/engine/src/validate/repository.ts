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
 * `realPath`, or `undefined` when it cannot be resolved for any reason (absent, a file used as a directory,
 * a symlink loop, an unreadable directory): one hostile frontmatter value must not fail the whole run, and
 * `fs.exists` used to answer `false` for the first three as well.
 */
const realOrUndefined = (fs: FileSystem.FileSystem, target: string): Effect.Effect<string | undefined> =>
	fs.realPath(target).pipe(Effect.orElseSucceed(() => undefined));

/**
 * Resolves one candidate: `found` at its real path, `outside` when that real path (or, for a path `realPath`
 * cannot see, its parent's) leaves `realRoots`, `missing` otherwise. A path `realPath` cannot see but `lstat`
 * can is a document that lives only in the editor overlay (the overlay shadows `lstat`, not `realPath`): it
 * counts at its parent's real path, unless it is a symlink (dangling). The `lstat` runs only after the parent
 * has been shown to be inside, so nothing is ever statted through a link that leads out of the project.
 */
const resolveCandidate = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	realRoots: ReadonlyArray<string>,
	absolute: string,
): Effect.Effect<ResourceLocation> =>
	Effect.gen(function* () {
		const inside = (real: string) => realRoots.some((root) => withinRoot(root, real, path));
		const real = yield* realOrUndefined(fs, absolute);
		if (real !== undefined) {
			return inside(real) ? ({ _tag: "found", absolute, real } as const) : ({ _tag: "outside" } as const);
		}
		const parent = yield* realOrUndefined(fs, path.dirname(absolute));
		if (parent === undefined) return { _tag: "missing" } as const;
		if (!inside(parent)) return { _tag: "outside" } as const;
		const info = yield* fs.lstat(absolute).pipe(Effect.orElseSucceed(() => undefined));
		return info === undefined || info.type === "SymbolicLink"
			? ({ _tag: "missing" } as const)
			: ({ _tag: "found", absolute, real: path.join(parent, path.basename(absolute)) } as const);
	});

/**
 * Resolves a literal `resource` value to a real path inside the project, trying each candidate in order.
 * A candidate is resolved with `realPath` (resolving a link to decide containment is permitted); one whose real
 * path leaves the real project root (and the real bundle root) is never `exists`ed, `stat`ed, read or descended,
 * so a symlink, or a symlinked parent, that leads out of the project is reported `outside`. A value with no
 * in-project candidate is `outside` without touching the filesystem at all. Any `realPath` failure counts as
 * `missing`.
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
			const located = yield* resolveCandidate(fs, path, realRoots, candidate.absolute);
			if (located._tag === "found") return located;
			if (located._tag === "outside") escaped = true;
		}
		return escaped ? ({ _tag: "outside" } as const) : ({ _tag: "missing" } as const);
	});

/**
 * The `resource-outside-project` diagnostic for one value, ranged at its frontmatter path. okfit's own
 * repository check, not OKF.
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
