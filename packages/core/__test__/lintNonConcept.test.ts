import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { Bundle } from "../src/Bundle.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";

const load = (sources: Record<string, string>) => {
	const mount = "/repo/non-concept";
	const seed: Record<string, string> = {};
	for (const [relative, content] of Object.entries(sources)) seed[`${mount}/${relative}`] = content;
	return Effect.provide(Bundle.load({ root: mount }), Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer));
};

const withGlobs = (globs: ReadonlyArray<string>, lint: Record<string, "off" | "warn"> = {}): OkfitConfig =>
	OkfitConfig.merge(OkfitConfig.DEFAULTS, { bundle: { non_concepts: [...globs] }, lint, extensions: {} });

const unlisted = (bundle: Parameters<typeof Validate.lint>[0], config: OkfitConfig) =>
	Validate.lint(bundle, config)
		.filter((d) => d.code === "non-concept-unlisted")
		.map((d) => d.file);

const SOURCES = {
	"README.md": "# Readme\n",
	"notes.md": "# Notes\n",
	"docs/a/README.md": "# Nested\n",
	"typeless.md": "---\ntitle: No type\n---\n\n# Typeless\n",
	"concept.md": "---\ntype: Note\n---\n\n# Concept\n",
};

describe("non-concept-unlisted", () => {
	it.effect("is silent without a non_concepts key, while type-missing and frontmatter-missing still fire", () =>
		Effect.gen(function* () {
			const bundle = yield* load(SOURCES);
			assert.deepStrictEqual(unlisted(bundle, OkfitConfig.DEFAULTS), []);
			const loadCodes = bundle.diagnostics.map((d) => [d.file, d.code]).sort();
			assert.deepStrictEqual(loadCodes, [
				["README.md", "frontmatter-missing"],
				["docs/a/README.md", "frontmatter-missing"],
				["notes.md", "frontmatter-missing"],
				["typeless.md", "type-missing"],
			]);
		}),
	);

	it.effect("fires on every typeless file no glob matches, and an empty list allows none", () =>
		Effect.gen(function* () {
			const bundle = yield* load(SOURCES);
			assert.deepStrictEqual(unlisted(bundle, withGlobs(["**/README.md"])).sort(), ["notes.md", "typeless.md"]);
			assert.deepStrictEqual(unlisted(bundle, withGlobs([])).sort(), [
				"README.md",
				"docs/a/README.md",
				"notes.md",
				"typeless.md",
			]);
		}),
	);

	it.effect("words the reason by the load diagnostic and keeps type-missing and frontmatter-missing unchanged", () =>
		Effect.gen(function* () {
			const bundle = yield* load(SOURCES);
			const config = withGlobs(["**/README.md", "**/AGENTS.md"]);
			const found = Validate.lint(bundle, config).filter((d) => d.code === "non-concept-unlisted");
			const byFile = Object.fromEntries(found.map((d) => [d.file, d.message]));
			assert.strictEqual(
				byFile["notes.md"],
				"notes.md is not a concept (no frontmatter) and matches no [bundle] non_concepts glob (**/README.md, **/AGENTS.md); add frontmatter with a type, move it out of the bundle, or list it in non_concepts",
			);
			assert.match(byFile["typeless.md"] ?? "", /\(no type\)/);
			assert.isTrue(found.every((d) => d.severity === "warning"));
			// R46: the listed README keeps its load diagnostic.
			assert.isTrue(bundle.diagnostics.some((d) => d.file === "README.md" && d.code === "frontmatter-missing"));
		}),
	);

	it.effect("copies the load diagnostic's range, and off silences only this code", () =>
		Effect.gen(function* () {
			const bundle = yield* load(SOURCES);
			const config = withGlobs([]);
			const loadDiagnostic = bundle.diagnostics.find((d) => d.file === "typeless.md");
			const lint = Validate.lint(bundle, config).find(
				(d) => d.code === "non-concept-unlisted" && d.file === "typeless.md",
			);
			assert.deepStrictEqual(lint?.range, loadDiagnostic?.range);
			const off = withGlobs([], { non_concept_unlisted: "off" });
			assert.deepStrictEqual(unlisted(bundle, off), []);
			assert.isTrue(bundle.diagnostics.length > 0);
		}),
	);

	it.effect("never fires on a typed concept, even one named README.md", () =>
		Effect.gen(function* () {
			const bundle = yield* load({ "README.md": "---\ntype: Note\n---\n\n# Typed\n", "notes.md": "# Notes\n" });
			assert.deepStrictEqual(unlisted(bundle, withGlobs([])), ["notes.md"]);
		}),
	);
});
