import type { GitCommandError, UnknownRefError } from "@effected/git";
import { Git } from "@effected/git";
import type { LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfitConfig as OkfitConfigNS } from "@okfit/core";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Path } from "effect";
import { isDescriptor, resourceCandidates, resourceValuesOf } from "./resources.js";

type State = "tracked" | "ignored" | "untracked";

/**
 * Classifies repo-relative paths (all existing on disk) against ONE repository:
 * a path inside a registered submodule is delegated to that submodule's own
 * index (recursing for nested submodules); the submodule path itself is
 * tracked (it is a gitlink); everything else costs one `Git.lsFiles` and at
 * most one `Git.checkIgnore` for the whole batch. A directory is tracked when
 * the index lists at least one file under it. A submodule that cannot be
 * queried counts as tracked, since the superproject tracks the submodule path
 * itself.
 */
const classify = (
	git: Git["Service"],
	repoRoot: string,
	rels: ReadonlyArray<string>,
	join: (...parts: Array<string>) => string,
): Effect.Effect<Map<string, State>, never> =>
	Effect.gen(function* () {
		const result = new Map<string, State>();
		const submodules = yield* git.submoduleStatus(repoRoot).pipe(Effect.orElseSucceed(() => []));
		const own: Array<string> = [];
		const nested = new Map<string, Array<string>>();
		for (const rel of rels) {
			const sub = submodules.find((entry) => rel === entry.path || rel.startsWith(`${entry.path}/`));
			if (sub === undefined) {
				own.push(rel);
			} else if (rel === sub.path) {
				result.set(rel, "tracked");
			} else {
				const bucket = nested.get(sub.path) ?? [];
				bucket.push(rel);
				nested.set(sub.path, bucket);
			}
		}
		for (const [subPath, bucket] of nested) {
			const inner = yield* classify(
				git,
				join(repoRoot, subPath),
				bucket.map((rel) => rel.slice(subPath.length + 1)),
				join,
			);
			for (const rel of bucket) result.set(rel, inner.get(rel.slice(subPath.length + 1)) ?? "tracked");
		}
		if (own.length === 0) return result;
		// A failed query means we cannot prove anything: report nothing rather than guess.
		const entries = yield* git.lsFiles(repoRoot, { pathspec: own }).pipe(Effect.option);
		if (entries._tag === "None") {
			for (const rel of own) result.set(rel, "tracked");
			return result;
		}
		const indexed = entries.value.map((entry) => entry.path);
		const notTracked = own.filter((rel) => !indexed.some((p) => p === rel || p.startsWith(`${rel}/`)));
		for (const rel of own) if (!notTracked.includes(rel)) result.set(rel, "tracked");
		if (notTracked.length === 0) return result;
		const ignored = yield* git.checkIgnore(repoRoot, notTracked).pipe(Effect.option);
		const ignoredSet = new Set(ignored._tag === "Some" ? ignored.value : []);
		for (const rel of notTracked) result.set(rel, ignoredSet.has(rel) ? "ignored" : "untracked");
		return result;
	});

/**
 * Issue #279: a `resource` or `sources[].resource` literal path that exists on
 * disk but would not exist in a clean checkout. `resource-ignored` flags a
 * gitignored file; `resource-untracked` flags a file git does not track yet
 * (never raised once the file is staged, since the index lists it). Scope is
 * the literal `resource` / `sources[].resource` values `lintResources` walks:
 * descriptors and globs are skipped, and a missing file stays
 * `source-resource-missing`'s. A bundle outside a git repository is skipped,
 * as is everything when both codes are `off` (no filesystem or git access).
 * The git queries are batched: one `lsFiles` and at most one `checkIgnore` per
 * repository, with submodules resolved against their own index.
 *
 * @public
 */
export const lintUntrackedResources = (
	bundle: LoadedBundle,
	config: OkfitConfig,
): Effect.Effect<
	ReadonlyArray<Diagnostic>,
	PlatformError.PlatformError | GitCommandError | UnknownRefError,
	FileSystem.FileSystem | Path.Path | Git
> =>
	Effect.gen(function* () {
		const ignoredSeverity = OkfitConfigNS.severityFor(config, "resource-ignored");
		const untrackedSeverity = OkfitConfigNS.severityFor(config, "resource-untracked");
		if (ignoredSeverity === "off" && untrackedSeverity === "off") return [];
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const git = yield* Git;

		// Existing literal targets first: no git spawn unless there is something to check.
		const targets: Array<{
			readonly concept: LoadedConcept;
			readonly value: string;
			readonly fieldPath: ReadonlyArray<string | number>;
			readonly real: string;
		}> = [];
		for (const [, concept] of bundle.concepts) {
			for (const { value, path: fieldPath } of resourceValuesOf(concept)) {
				if (isDescriptor(value)) continue;
				for (const candidate of resourceCandidates(bundle, concept, value, path)) {
					if (!(yield* fs.exists(candidate))) continue;
					const real = yield* fs.realPath(candidate);
					targets.push({ concept, value, fieldPath, real });
					break;
				}
			}
		}
		if (targets.length === 0) return [];

		const top = yield* git
			.repoRoot(yield* fs.realPath(bundle.root))
			.pipe(Effect.catchTag("NotARepositoryError", () => Effect.succeed(undefined)));
		if (top === undefined) return [];
		const topReal = yield* fs.realPath(top);

		const relOf = (real: string): string | undefined => {
			const rel = path.relative(topReal, real);
			return rel === "" || rel.startsWith("..") || path.isAbsolute(rel) ? undefined : rel.split(path.sep).join("/");
		};
		const rels = [...new Set(targets.flatMap((t) => relOf(t.real) ?? []))];
		if (rels.length === 0) return [];
		const states = yield* classify(git, topReal, rels, (...parts) => path.join(...parts));

		const diagnostics: Array<Diagnostic> = [];
		for (const target of targets) {
			const rel = relOf(target.real);
			const state = rel === undefined ? "tracked" : (states.get(rel) ?? "tracked");
			if (state === "tracked") continue;
			const severity = state === "ignored" ? ignoredSeverity : untrackedSeverity;
			if (severity === "off") continue;
			const range = DiagnosticRange.forFrontmatterPath(target.concept.document, target.fieldPath);
			diagnostics.push(
				Diagnostic.make({
					file: target.concept.path,
					code: state === "ignored" ? "resource-ignored" : "resource-untracked",
					severity,
					message:
						state === "ignored"
							? `Resource "${target.value}" exists locally but is gitignored, so other checkouts will not have it; restate the reasoning in the concept instead of citing it`
							: `Resource "${target.value}" exists locally but is not tracked by git yet; add it to the index or stop citing it`,
					...(range === undefined ? {} : { range }),
				}),
			);
		}
		return diagnostics;
	});
