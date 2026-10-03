import { GlobPattern } from "@effected/glob";
import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfitConfig as OkfitConfigNS } from "@okfit/core";
import { SURFACE_TYPE } from "@okfit/profiles";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path, Result } from "effect";
import { GLOB_RE } from "./resources.js";

/**
 * Lists `root` breadth-first, only as deep as `segments` (the glob's remaining
 * segments) can match, or without a bound when the pattern contains `**`.
 * `node_modules` and dot-entries are skipped unless a segment names them, and
 * symlinked directories are listed but never descended into. Entry
 * paths are `/`-joined and relative to `root`. An unreadable directory
 * contributes nothing.
 */
const walk = (
	fs: FileSystem.FileSystem,
	path: Path.Path,
	root: string,
	segments: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>> =>
	Effect.gen(function* () {
		const maxDepth = segments.some((segment) => segment.includes("**")) ? Number.POSITIVE_INFINITY : segments.length;
		// A dot names a hidden entry when it starts a segment or follows a brace,
		// comma, extglob or class opener (`{.github,docs}`, `[.]x`, `@(.a|b)`).
		const namesHidden = segments.some((segment) => /(^|[{,(|[])\./.test(segment));
		const namesModules = segments.some((segment) => segment.includes("node_modules"));
		const skipped = (name: string): boolean =>
			(name === "node_modules" && !namesModules) || (name.startsWith(".") && !namesHidden);
		const out: Array<string> = [];
		let level: ReadonlyArray<string> = [""];
		for (let depth = 1; depth <= maxDepth && level.length > 0; depth++) {
			const next: Array<string> = [];
			for (const dir of level) {
				const names = yield* fs
					.readDirectory(dir === "" ? root : path.join(root, dir))
					.pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
				for (const name of names) {
					if (skipped(name)) continue;
					const relative = dir === "" ? name : `${dir}/${name}`;
					out.push(relative);
					if (depth < maxDepth) {
						const full = path.join(root, relative);
						const isDirectory = yield* fs.stat(full).pipe(
							Effect.map((info) => info.type === "Directory"),
							Effect.orElseSucceed(() => false),
						);
						// Never descend into a symlink: a cycle under `**` would not end.
						const isSymlink = isDirectory
							? yield* fs.readLink(full).pipe(
									Effect.as(true),
									Effect.orElseSucceed(() => false),
								)
							: false;
						if (isDirectory && !isSymlink) next.push(relative);
					}
				}
			}
			level = next;
		}
		return out;
	});

/**
 * A Surface's `resource` glob matches nothing on disk. Only concepts of type
 * `Surface` whose `resource` contains a glob metacharacter are checked; a
 * literal `resource` is `lintResources`'s concern (`source-resource-missing`).
 * The pattern is split, as written, at its first metacharacter segment into a
 * static `prefix` (resolved against the concept's directory) and a `rest`; the
 * `prefix` directory is walked only as deep as `rest` can match (unbounded with
 * `**`, skipping `node_modules` and dot-directories `rest` does not name) and
 * `rest` is matched against the entries. A missing or unreadable `prefix` (for
 * example a file), an empty match, or a `rest` that fails to compile all count
 * as unmatched, and report a warning (a brand-new monorepo legitimately has no
 * packages yet), ranged at the `["resource"]` frontmatter value. Total over
 * severity (mirrors `lintResources`): returns `[]`, touching neither
 * `FileSystem` nor `Path`, the moment
 * `OkfitConfig.severityFor(config, "surface-unmatched")` is `"off"`.
 *
 * @public
 */
export const lintSurfaces = (
	bundle: LoadedBundle,
	config: OkfitConfig,
): Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const severity = OkfitConfigNS.severityFor(config, "surface-unmatched");
		if (severity === "off") return [];
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const diagnostics: Array<Diagnostic> = [];
		for (const [, concept] of bundle.concepts) {
			if (concept.frontmatter.type !== SURFACE_TYPE) continue;
			const resource = concept.frontmatter.resource;
			if (resource === undefined || !GLOB_RE.test(resource)) continue;
			// Split on the resource as written, not on the resolved absolute path:
			// a metacharacter in the bundle root's own path must not move the split.
			const written = resource.split("/");
			const firstGlob = written.findIndex((segment) => GLOB_RE.test(segment));
			if (firstGlob < 0) continue;
			const prefix = path.resolve(bundle.root, path.dirname(concept.path), ...written.slice(0, firstGlob));
			const restSegments = written.slice(firstGlob);
			const rest = restSegments.join("/");
			let problem: string | undefined;
			if (!(yield* fs.exists(prefix).pipe(Effect.orElseSucceed(() => false)))) {
				problem = "";
			} else {
				const compiled = GlobPattern.compileResult(rest);
				if (Result.isFailure(compiled)) {
					problem = `: ${compiled.failure.message}`;
				} else {
					const entries = yield* walk(fs, path, prefix, restSegments);
					if (!entries.some((entry) => compiled.success.matches(entry))) problem = "";
				}
			}
			if (problem === undefined) continue;
			const range = DiagnosticRange.forFrontmatterPath(concept.document, ["resource"]);
			diagnostics.push(
				Diagnostic.make({
					file: concept.path,
					code: "surface-unmatched",
					severity,
					message: `Surface resource "${resource}" matches nothing under ${path.relative(bundle.root, prefix) || "."}${problem}`,
					...(range === undefined ? {} : { range }),
				}),
			);
		}
		return diagnostics;
	});
