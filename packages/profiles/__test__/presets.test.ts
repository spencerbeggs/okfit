import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Bundle, OkfitConfig, Validate } from "@okfit/core";
import { Effect, Layer } from "effect";
import type { DocsPreset, SurfaceTemplate } from "../src/Profile.js";
import { Profiles } from "../src/Profiles.js";

const profile = Profiles.softwareProject;
const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, profile.config);
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const presets = profile.docsPresets;

const render = (template: SurfaceTemplate): string => {
	const lines = Object.entries(template.frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
	return `---\n${lines.join("\n")}\n---\n\n${template.body}\n`;
};

const writeBundle = async (preset: DocsPreset): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "okfit-preset-"));
	await writeFile(join(root, "index.md"), '---\nokf_version: "0.2"\n---\n\n# Project\n\n* [t](project.md) - t.\n');
	await writeFile(
		join(root, "project.md"),
		"---\ntype: Project\ntitle: t\ndescription: A test project.\n---\n\n# t\n\nBody.\n",
	);
	for (const surface of preset.surfaces) {
		const target = join(root, surface.file);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, render(surface));
	}
	return root;
};

describe("softwareProject.docsPresets", () => {
	it("names exactly the four presets", () => {
		assert.deepStrictEqual(presets.map((p) => p.name).sort(), [
			"monorepo-router",
			"monorepo-shared-docs",
			"npm-package",
			"site",
		]);
	});

	it("marks only site additive", () => {
		assert.deepStrictEqual(
			presets.filter((p) => p.additive).map((p) => p.name),
			["site"],
		);
	});

	for (const preset of presets) {
		it.effect(`${preset.name}: every template validates clean`, () =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => writeBundle(preset));
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(platform));
				const report = Validate.all(bundle, merged);
				const errors = [...report.conformance, ...report.lint, ...profile.check(bundle)].filter(
					(d) => d.severity === "error",
				);
				assert.deepStrictEqual(errors, []);
				assert.strictEqual(bundle.concepts.size, preset.surfaces.length + 1);
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}),
		);

		for (const surface of preset.surfaces) {
			it(`${preset.name}/${surface.file}: body carries each durable rule`, () => {
				const body = surface.body.toLowerCase();
				for (const rule of ["sentence case", "language", "expected output", "never invent", "npm", "version number"]) {
					assert.include(body, rule, `${surface.file} lacks "${rule}"`);
				}
				assert.strictEqual(surface.frontmatter.type, "Surface");
			});
		}
	}
});
