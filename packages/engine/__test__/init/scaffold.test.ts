import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle } from "@okfit/core";
import { Profiles } from "@okfit/profiles";
import { Effect, Layer, Path } from "effect";
import type { ScaffoldOptions } from "../../src/init/scaffold.js";
import { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "../../src/init/scaffold.js";

const OPTIONS: ScaffoldOptions = {
	projectRoot: "/tmp/my-repo",
	bundleRoot: "/tmp/my-repo/okf",
	layout: Profiles.softwareProject.layout,
	profileName: "software-project",
	projectTitle: "my-repo",
	today: "2026-09-05",
	okfVersion: "0.2",
};

describe("CONFIG_RELATIVE_PATH", () => {
	it("writes the config to .config/okfit.toml", () => {
		assert.strictEqual(CONFIG_RELATIVE_PATH, ".config/okfit.toml");
	});
});

describe("targetPaths", () => {
	it("lists all three project-level config names in targetPaths", () => {
		assert.deepStrictEqual(targetPaths(OPTIONS), [
			"/tmp/my-repo/.okfit.toml",
			"/tmp/my-repo/okfit.toml",
			"/tmp/my-repo/.config/okfit.toml",
			"/tmp/my-repo/okf/index.md",
			"/tmp/my-repo/okf/log.md",
			"/tmp/my-repo/okf/project.md",
			"/tmp/my-repo/okf/modules/index.md",
			"/tmp/my-repo/okf/decisions/index.md",
			"/tmp/my-repo/okf/conventions/index.md",
			"/tmp/my-repo/okf/interfaces/index.md",
			"/tmp/my-repo/okf/references/index.md",
			"/tmp/my-repo/okf/runbooks/index.md",
			"/tmp/my-repo/okf/glossary/index.md",
			"/tmp/my-repo/okf/limitations/index.md",
			"/tmp/my-repo/okf/models/index.md",
			"/tmp/my-repo/okf/gotchas/index.md",
			"/tmp/my-repo/okf/consumers/index.md",
			"/tmp/my-repo/okf/roadmaps/index.md",
			"/tmp/my-repo/okf/measurements/index.md",
			"/tmp/my-repo/okf/invariants/index.md",
			"/tmp/my-repo/okf/incidents/index.md",
			"/tmp/my-repo/okf/surfaces/index.md",
			"/tmp/my-repo/okf/publications/index.md",
			"/tmp/my-repo/okf/flows/index.md",
			"/tmp/my-repo/okf/fixtures/index.md",
		]);
		assert.strictEqual(targetPaths(OPTIONS).length, 6 + Profiles.softwareProject.layout.directories.length);
	});
});

describe("configValue", () => {
	it("is the thin override: bundle.path/profile plus an empty extensions record, nothing else (K-23)", () => {
		assert.deepStrictEqual(configValue({ ...OPTIONS, bundlePath: "okf" }), {
			bundle: { path: "okf", profile: "software-project" },
			extensions: {},
		});
	});
});

describe("files", () => {
	it.effect("renders project.md's frontmatter with exactly four keys, byte-for-byte (K-26)", () =>
		files(OPTIONS).pipe(
			Effect.map((entries) => {
				const project = entries.find((entry) => entry.path === "/tmp/my-repo/okf/project.md");
				assert.strictEqual(
					project?.contents,
					[
						"---",
						"type: Project",
						"title: my-repo",
						"description: What this project is, its boundaries, and its non-goals.",
						"status: draft",
						"---",
						"",
						"# my-repo",
						"",
						"## Purpose",
						"",
						"Describe what this project is for in one paragraph.",
						"",
						"## Boundaries",
						"",
						"Describe what this project owns and what it deliberately leaves to others.",
						"",
						"## Non-goals",
						"",
						"List what this project will not do, so a reader never infers it from silence.",
						"",
					].join("\n"),
				);
				return undefined;
			}),
		),
	);

	it.effect("renders the root index.md via Derive.renderIndex over the synthesized project concept (K-27, K-59)", () =>
		files(OPTIONS).pipe(
			Effect.map((entries) => {
				const index = entries.find((entry) => entry.path === "/tmp/my-repo/okf/index.md");
				assert.strictEqual(
					index?.contents,
					[
						"---",
						"okf_version: '0.2'",
						"title: my-repo",
						"description: What this project is, how it is built, and why it is built that way.",
						"---",
						"",
						"# Project",
						"",
						"* [my-repo](project.md) - What this project is, its boundaries, and its non-goals.",
						"",
						"# Subdirectories",
						"",
						"* [consumers](consumers/index.md)",
						"* [conventions](conventions/index.md)",
						"* [decisions](decisions/index.md)",
						"* [fixtures](fixtures/index.md)",
						"* [flows](flows/index.md)",
						"* [glossary](glossary/index.md)",
						"* [gotchas](gotchas/index.md)",
						"* [incidents](incidents/index.md)",
						"* [interfaces](interfaces/index.md)",
						"* [invariants](invariants/index.md)",
						"* [limitations](limitations/index.md)",
						"* [measurements](measurements/index.md)",
						"* [models](models/index.md)",
						"* [modules](modules/index.md)",
						"* [publications](publications/index.md)",
						"* [references](references/index.md)",
						"* [roadmaps](roadmaps/index.md)",
						"* [runbooks](runbooks/index.md)",
						"* [surfaces](surfaces/index.md)",
						"",
					].join("\n"),
				);
				return undefined;
			}),
		),
	);

	it.effect("renders log.md via Derive.renderLog: a # Log title, then today's entry (K-25, issue #30)", () =>
		files(OPTIONS).pipe(
			Effect.map((entries) => {
				const log = entries.find((entry) => entry.path === "/tmp/my-repo/okf/log.md");
				assert.strictEqual(
					log?.contents,
					"# Log\n\n## 2026-09-05\n\n* Initialized the bundle with the software-project profile\n",
				);
				return undefined;
			}),
		),
	);

	it.effect("renders every per-directory index.md as a literal H1, nothing else (K-27, K-59)", () =>
		files(OPTIONS).pipe(
			Effect.map((entries) => {
				for (const [directory, heading] of [
					["modules", "Modules"],
					["decisions", "Decisions"],
					["conventions", "Conventions"],
					["interfaces", "Interfaces"],
					["references", "References"],
					["runbooks", "Runbooks"],
					["glossary", "Glossary"],
					["limitations", "Limitations"],
					["models", "Models"],
					["gotchas", "Gotchas"],
					["consumers", "Consumers"],
					["roadmaps", "Roadmaps"],
					["measurements", "Measurements"],
					["invariants", "Invariants"],
					["incidents", "Incidents"],
					["surfaces", "Surfaces"],
					["publications", "Publications"],
					["flows", "Flows"],
					["fixtures", "Fixtures"],
				] as const) {
					const entry = entries.find((candidate) => candidate.path === `/tmp/my-repo/okf/${directory}/index.md`);
					assert.strictEqual(entry?.contents, `# ${heading}\n`);
				}
				assert.strictEqual(entries.length, 22);
				return undefined;
			}),
		),
	);

	describe("files okfVersion", () => {
		const rootIndex = (okfVersion: string) =>
			files({ ...OPTIONS, okfVersion }).pipe(
				Effect.map((entries) => entries.find((entry) => entry.path === "/tmp/my-repo/okf/index.md")?.contents ?? ""),
			);

		it.effect("writes the okfVersion it is given into the root index", () =>
			Effect.gen(function* () {
				assert.include(yield* rootIndex("0.3"), "okf_version: '0.3'");
				// control: another value lands instead, so the option is what decides
				const older = yield* rootIndex("0.2");
				assert.include(older, "okf_version: '0.2'");
				assert.notInclude(older, "0.3");
			}),
		);
	});

	it.effect("writes the bundle title and description, and Bundle.load reads them back clean (OKF 0.3 §8.1)", () =>
		Effect.gen(function* () {
			const entries = yield* files({ ...OPTIONS, okfVersion: "0.3" });
			const seed = Object.fromEntries(entries.map((entry) => [entry.path, entry.contents]));
			const bundle = yield* Bundle.load({ root: "/tmp/my-repo/okf" }).pipe(
				Effect.provide(Layer.merge(Path.layer, MemoryFileSystem.layerWith(seed))),
			);
			const root = bundle.indexes.get("");
			assert.strictEqual(root?.title, "my-repo");
			assert.strictEqual(root?.description, "What this project is, how it is built, and why it is built that way.");
			assert.strictEqual(root?.okfVersion, "0.3");
			assert.isFalse(bundle.diagnostics.some((diagnostic) => diagnostic.code === "index-metadata-invalid"));
			// control: the decode is live, so a different title in the seed reads back differently
			const other = yield* Bundle.load({ root: "/tmp/my-repo/okf" }).pipe(
				Effect.provide(
					Layer.merge(
						Path.layer,
						MemoryFileSystem.layerWith({
							...seed,
							"/tmp/my-repo/okf/index.md": "---\ntitle: Other\n---\n\n# Project\n",
						}),
					),
				),
			);
			assert.strictEqual(other.indexes.get("")?.title, "Other");
		}),
	);
});
