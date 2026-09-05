import { assert, describe, it } from "@effect/vitest";
import { Profiles } from "@okfit/profiles";
import { Effect } from "effect";
import type { ScaffoldOptions } from "../../src/init/scaffold.js";
import { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "../../src/init/scaffold.js";

const OPTIONS: ScaffoldOptions = {
	projectRoot: "/tmp/my-repo",
	bundleRoot: "/tmp/my-repo/okf",
	layout: Profiles.softwareProject.layout,
	profileName: "software-project",
	projectTitle: "my-repo",
	today: "2026-09-05",
};

describe("CONFIG_RELATIVE_PATH", () => {
	it("is the project-root-relative config path (K-23)", () => {
		assert.strictEqual(CONFIG_RELATIVE_PATH, ".config/okfit/config.toml");
	});
});

describe("targetPaths", () => {
	it("returns the nine software-project paths in write order, never a hand-counted literal", () => {
		assert.deepStrictEqual(targetPaths(OPTIONS), [
			"/tmp/my-repo/.config/okfit/config.toml",
			"/tmp/my-repo/okf/index.md",
			"/tmp/my-repo/okf/log.md",
			"/tmp/my-repo/okf/project.md",
			"/tmp/my-repo/okf/modules/index.md",
			"/tmp/my-repo/okf/decisions/index.md",
			"/tmp/my-repo/okf/conventions/index.md",
			"/tmp/my-repo/okf/interfaces/index.md",
			"/tmp/my-repo/okf/references/index.md",
		]);
		assert.strictEqual(targetPaths(OPTIONS).length, 4 + Profiles.softwareProject.layout.directories.length);
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
						'okf_version: "0.2"',
						"---",
						"",
						"# Project",
						"",
						"* [my-repo](project.md) - What this project is, its boundaries, and its non-goals.",
						"",
						"# Subdirectories",
						"",
						"* [conventions](conventions/index.md)",
						"* [decisions](decisions/index.md)",
						"* [interfaces](interfaces/index.md)",
						"* [modules](modules/index.md)",
						"* [references](references/index.md)",
						"",
					].join("\n"),
				);
				return undefined;
			}),
		),
	);

	it.effect("renders log.md via Derive.renderLogEntry with today's date (K-25)", () =>
		files(OPTIONS).pipe(
			Effect.map((entries) => {
				const log = entries.find((entry) => entry.path === "/tmp/my-repo/okf/log.md");
				assert.strictEqual(
					log?.contents,
					"## 2026-09-05\n* Initialized the bundle with the software-project profile\n",
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
				] as const) {
					const entry = entries.find((candidate) => candidate.path === `/tmp/my-repo/okf/${directory}/index.md`);
					assert.strictEqual(entry?.contents, `# ${heading}\n`);
				}
				assert.strictEqual(entries.length, 8);
				return undefined;
			}),
		),
	);
});
