import { Git } from "@effected/git";
import type { ConceptId, LoadedConcept } from "@okfit/core";
import { Bundle, LoadedBundle } from "@okfit/core";
import { Effect, FileSystem, Option, Path } from "effect";

/**
 * Issue #142: the committed view of a bundle for `--staged` index mode. A
 * pre-commit hook renders `index.md` into the commit, so the listing must come
 * from the index, not the working tree: an untracked concept is absent, a
 * concept removed with `git rm --cached` is absent, and a tracked concept with
 * unstaged edits renders its indexed title and description. A concept deleted
 * from the working tree but still in the index is loaded from its blob.
 *
 * `rels` maps each working-tree concept to its repo-relative physical path;
 * `stagedPaths` are concepts whose working tree is what gets committed (the
 * generated mode restages them whole), so they need no blob read.
 *
 * @internal
 */
export const committedView = Effect.fn("okfit/sync/committedView")(function* (
	bundle: LoadedBundle,
	repoRoot: string,
	rels: ReadonlyMap<ConceptId, string>,
	stagedPaths: ReadonlySet<string>,
) {
	const git = yield* Git;
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const realBundle = yield* fs.realPath(bundle.root);
	const prefix = path.relative(repoRoot, realBundle).split(path.sep).join("/");
	const entries = yield* git.lsFiles(repoRoot, { pathspec: [prefix === "" ? "." : prefix] });
	const indexed = new Set(entries.filter((entry) => entry.stage === 0).map((entry) => entry.path));
	const unstaged = new Set(yield* git.unstagedChanges(repoRoot));

	const kept = new Map<ConceptId, LoadedConcept>();
	// Bundle-relative paths whose index blob must be parsed instead of the working file.
	const fromBlob = new Set<string>();
	const known = new Set<string>();
	for (const [id, concept] of bundle.concepts) {
		const rel = rels.get(id);
		if (rel === undefined) continue;
		known.add(rel);
		if (!indexed.has(rel)) continue;
		kept.set(id, concept);
		if (unstaged.has(rel) && !stagedPaths.has(rel)) fromBlob.add(concept.path);
	}
	// Indexed markdown the working tree no longer holds (deleted, not yet staged).
	const workingFiles = new Set(bundle.files);
	const strip = prefix === "" ? "" : `${prefix}/`;
	for (const rel of indexed) {
		if (!rel.endsWith(".md") || known.has(rel) || !rel.startsWith(strip)) continue;
		const local = rel.slice(strip.length);
		if (!workingFiles.has(local)) fromBlob.add(local);
	}

	if (fromBlob.size > 0) {
		const parsed = yield* Effect.scoped(
			Effect.gen(function* () {
				const tmp = yield* fs.makeTempDirectoryScoped({ prefix: "okfit-index-" });
				for (const local of fromBlob) {
					const blob = yield* git.show(repoRoot, "", strip + local);
					if (Option.isNone(blob)) continue;
					const target = path.join(tmp, local);
					yield* fs.makeDirectory(path.dirname(target), { recursive: true });
					yield* fs.writeFileString(target, blob.value);
				}
				return yield* Bundle.load({ root: tmp });
			}),
		);
		for (const [id, concept] of parsed.concepts) kept.set(id, concept);
	}

	const directories = new Set<string>();
	for (const concept of kept.values()) {
		const slash = concept.path.lastIndexOf("/");
		directories.add(slash === -1 ? "" : concept.path.slice(0, slash));
	}
	return LoadedBundle.make({ ...bundle, concepts: kept, directories: [...directories].sort() });
});
