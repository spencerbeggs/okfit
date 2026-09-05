import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Toml } from "@effected/toml";
import { OkfitConfig } from "@okfit/core";
import { Effect, Schema } from "effect";
import { softwareProject } from "../src/SoftwareProject.js";

const { config, layout } = softwareProject;
const decode = Schema.decodeUnknownSync(OkfitConfig);
const encode = Schema.encodeSync(OkfitConfig);
const README = resolve(import.meta.dirname, "../README.md");
const TOML_FENCE = /```toml\r?\n([\s\S]*?)```/;

/** Sentence count: terminator followed by whitespace or end of text. */
const sentences = (text: string): number => text.split(/(?<=[.!?])\s+/).length;
const MARKDOWN = /[*_`[#]/;

const guidanceStrings = (): { descriptions: ReadonlyArray<string>; guidances: ReadonlyArray<string> } => {
	const descriptions: Array<string> = [];
	const guidances: Array<string> = [];
	for (const [name, type] of Object.entries(config.types ?? {})) {
		assert.isDefined(type.description, `${name}.description`);
		assert.isDefined(type.guidance, `${name}.guidance`);
		descriptions.push(type.description);
		guidances.push(type.guidance);
		for (const field of Object.values(type.fields ?? {})) {
			descriptions.push(field.description, ...Object.values(field.values ?? {}));
		}
	}
	for (const [name, tag] of Object.entries(config.tags ?? {})) {
		assert.isDefined(tag.description, `tags.${name}.description`);
		descriptions.push(tag.description);
	}
	return { descriptions, guidances };
};

describe("softwareProject.config", () => {
	it.effect("sets only concepts, types, tags and extensions; actors stays unset (P-25, P-17)", () =>
		Effect.sync(() => {
			assert.strictEqual(softwareProject.name, "software-project");
			assert.deepStrictEqual(Object.keys(config).sort(), ["concepts", "extensions", "tags", "types"]);
			assert.isUndefined(config.actors);
			assert.deepStrictEqual(config.extensions, {});
			assert.deepStrictEqual(config.concepts, { required: ["title", "description"], tags: { required: [] } });
		}),
	);

	it.effect("guard 1: round-trips through the OkfitConfig codec unchanged (P-25)", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(decode(encode(config)), config);
		}),
	);

	it.effect("guard 2: the README's first toml fence decodes to the same value (P-25)", () =>
		Effect.gen(function* () {
			const match = TOML_FENCE.exec(readFileSync(README, "utf8"));
			assert.isNotNull(match, "README.md has no ```toml fence");
			const parsed = yield* Toml.parse(match?.[1] ?? "");
			assert.deepStrictEqual(decode(parsed), config);
		}),
	);

	it.effect("carries the P-20 type table exactly", () =>
		Effect.sync(() => {
			const types = config.types ?? {};
			assert.deepStrictEqual(Object.keys(types).sort(), [
				"Convention",
				"Decision",
				"Interface",
				"Module",
				"Project",
				"Reference",
			]);
			assert.isFalse("required" in (types.Project ?? {}));
			assert.deepStrictEqual(types.Module?.required, ["resource", "kind"]);
			assert.deepStrictEqual(types.Interface?.required, ["kind"]);
			assert.deepStrictEqual(types.Reference?.required, ["sources"]);
			assert.strictEqual(types.Decision?.require_verified, true);
			assert.strictEqual(types.Decision?.fields?.supersedes?.kind, "path");
			assert.strictEqual(types.Module?.fields?.resource?.kind, "path");
			assert.strictEqual(types.Interface?.fields?.resource?.kind, "path");
			for (const [name, type] of Object.entries(types)) {
				assert.notDeepEqual(type.required, [], `${name} must not declare an explicit empty required`);
			}
			assert.deepStrictEqual(Object.keys(types.Module?.fields?.kind?.values ?? {}), [
				"workspace",
				"package",
				"website",
				"plugin",
				"action",
			]);
			assert.deepStrictEqual(Object.keys(types.Interface?.fields?.kind?.values ?? {}), [
				"api",
				"cli",
				"config",
				"wire",
				"mcp",
			]);
			assert.deepStrictEqual(Object.keys(config.tags ?? {}), [
				"architecture",
				"testing",
				"release",
				"security",
				"performance",
			]);
		}),
	);

	it.effect("every description is one sentence and every guidance at most two, plain text (P-42)", () =>
		Effect.sync(() => {
			const { descriptions, guidances } = guidanceStrings();
			assert.isAbove(descriptions.length, 20);
			assert.strictEqual(guidances.length, 6);
			for (const text of [...descriptions, ...guidances]) {
				assert.strictEqual(text, text.trim(), `trailing whitespace in ${JSON.stringify(text)}`);
				assert.isFalse(text.includes("\n"), `newline in ${JSON.stringify(text)}`);
				assert.isFalse(text.includes("  "), `double space in ${JSON.stringify(text)}`);
				assert.isFalse(MARKDOWN.test(text), `markdown in ${JSON.stringify(text)}`);
				assert.match(text, /[.!?]$/, `no terminator in ${JSON.stringify(text)}`);
			}
			for (const text of descriptions) assert.strictEqual(sentences(text), 1, JSON.stringify(text));
			for (const text of guidances) assert.isAtMost(sentences(text), 2, JSON.stringify(text));
		}),
	);
});

describe("softwareProject.layout", () => {
	it.effect("is the P-26 root triple plus one directory per non-Project type, and vice versa (P-37)", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(layout.root, { index: "index.md", log: "log.md", project: "project.md" });
			assert.deepStrictEqual(layout.directories, [
				{ directory: "modules", type: "Module" },
				{ directory: "decisions", type: "Decision" },
				{ directory: "conventions", type: "Convention" },
				{ directory: "interfaces", type: "Interface" },
				{ directory: "references", type: "Reference" },
			]);
			const layoutTypes = layout.directories.map((d) => d.type).sort();
			const configTypes = Object.keys(config.types ?? {})
				.filter((name) => name !== "Project")
				.sort();
			assert.deepStrictEqual(layoutTypes, configTypes);
			assert.strictEqual(new Set(layout.directories.map((d) => d.directory)).size, layout.directories.length);
		}),
	);
});

describe("OkfitConfig.merge(DEFAULTS, softwareProject.config)", () => {
	it.effect("keeps DEFAULTS' lint, lifecycle and bundle while adopting the profile's vocabulary", () =>
		Effect.sync(() => {
			const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, config);
			assert.deepStrictEqual(merged.bundle, { path: "okf", profile: "software-project" });
			assert.deepStrictEqual(merged.concepts, { required: ["title", "description"], tags: { required: [] } });
			assert.strictEqual(Object.keys(merged.types ?? {}).length, 6); // (checked) strictEqual for a number
			assert.strictEqual(OkfitConfig.severityFor(merged, "unknown-type"), "error");
			assert.strictEqual(OkfitConfig.severityFor(merged, "required-key-missing"), "error");
			assert.deepStrictEqual(merged.actors, { humans: [] });
		}),
	);
});
