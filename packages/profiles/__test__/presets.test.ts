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
const RULE_PHRASES = [
	"Use sentence case for every heading",
	"Give every code fence a language identifier",
	"Show the expected output of every example",
	"Never invent output, paths, identifiers or messages",
	"Lead install commands with npm or npx",
	"Never write a specific version number in prose",
];

const render = (template: SurfaceTemplate): string => {
	const lines = Object.entries(template.frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
	return `---\n${lines.join("\n")}\n---\n\n${template.body}\n`;
};

const writeBundle = async (preset: DocsPreset): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "okfit-preset-"));
	await writeFile(join(root, "index.md"), '---\nokf_version: "0.2"\n---\n\n# Project\n\n* [t](project.md) - t.\n');
	await writeFile(
		join(root, "project.md"),
		"---\ntype: Project\nstatus: stable\ntitle: t\ndescription: A test project.\n---\n\n# t\n\nBody.\n",
	);
	await mkdir(join(root, "surfaces"), { recursive: true });
	await writeFile(join(root, "surfaces", "index.md"), "# Surfaces\n\n* [x](x.md) - x.\n");
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

	it("composes each preset as the spec's table says", () => {
		const shape = (name: string) =>
			presets
				.find((p) => p.name === name)
				?.surfaces.map((x) => `${x.file}:${x.frontmatter.audience}:${x.frontmatter.links_to ?? ""}`)
				.sort();
		assert.deepStrictEqual(shape("npm-package"), [
			"surfaces/docs-repo.md:users:",
			"surfaces/readme-package.md:users:docs-repo.md",
		]);
		assert.deepStrictEqual(shape("monorepo-router"), [
			"surfaces/readme-packages.md:users:",
			"surfaces/readme-root.md:contributors:",
		]);
		assert.deepStrictEqual(shape("monorepo-shared-docs"), [
			"surfaces/contributor-guides.md:contributors:readme-root.md",
			"surfaces/docs-packages.md:users:readme-packages.md",
			"surfaces/docs-repo.md:contributors:readme-root.md",
			"surfaces/readme-packages.md:users:",
			"surfaces/readme-root.md:contributors:",
		]);
		const site = presets.find((p) => p.name === "site")?.surfaces ?? [];
		assert.strictEqual(site.find((x) => x.file === "surfaces/site.md")?.frontmatter.audience, "users");
		assert.isString(site.find((x) => x.file === "surfaces/site.md")?.frontmatter.url);
		for (const x of site.filter((y) => y.frontmatter.kind === "readme")) {
			assert.strictEqual(x.frontmatter.links_to, "site.md");
		}
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
				const noisy = [...report.conformance, ...report.lint, ...profile.check(bundle)].filter(
					(d) => d.severity === "error" || d.severity === "warning",
				);
				assert.deepStrictEqual(noisy, []);
				assert.strictEqual(bundle.concepts.size, preset.surfaces.length + 1);
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}),
		);

		for (const surface of preset.surfaces) {
			it(`${preset.name}/${surface.file}: body carries each durable rule`, () => {
				const body = surface.body.toLowerCase();
				for (const rule of RULE_PHRASES) {
					assert.include(body, rule.toLowerCase(), `${surface.file} lacks "${rule}"`);
				}
				assert.strictEqual(surface.frontmatter.type, "Surface");
			});
		}
	}
});
