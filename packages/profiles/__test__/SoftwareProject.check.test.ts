import { resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { Diagnostic } from "@okfit/core";
import { Bundle, OkfitConfig, Validate } from "@okfit/core";
import { Effect, Layer } from "effect";
import type { ProfileDiagnostic } from "../src/Profile.js";
import { Profiles } from "../src/Profiles.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");
/** Real disk, read-only static fixtures (P-49). Module-scoped so the layer is built once. */
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const profile = Profiles.softwareProject;
const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, profile.config);

const load = (relative: string) => Bundle.load({ root: resolve(FIXTURES, relative) }).pipe(Effect.provide(platform));
const codes = (diagnostics: ReadonlyArray<Diagnostic | ProfileDiagnostic>): ReadonlyArray<[string, string]> =>
	diagnostics.map((d): [string, string] => [d.code, d.file]); // (checked) tuple annotation: an unannotated callback infers string[]

interface BadCase {
	readonly name: string;
	readonly lint: ReadonlyArray<[string, string]>;
	readonly check: ReadonlyArray<[string, string]>;
	readonly message?: RegExp;
}

/** P-37's eight cases, the P-23 positive control, and the both-defects case (decision 8). */
const BAD_CASES: ReadonlyArray<BadCase> = [
	{ name: "module-no-kind", lint: [["required-key-missing", "modules/core.md"]], check: [], message: /"kind"/ },
	{
		name: "module-kind-unknown",
		lint: [["field-value-unknown", "modules/core.md"]],
		check: [],
		message: /"library".*workspace, package, website, plugin, action/,
	},
	{ name: "decision-unverified", lint: [["require-verified-unmet", "decisions/effect-v4.md"]], check: [] },
	{
		name: "reference-no-sources",
		lint: [["required-key-missing", "references/okf-spec.md"]],
		check: [],
		message: /"sources"/,
	},
	{ name: "interface-no-kind", lint: [["required-key-missing", "interfaces/cli.md"]], check: [], message: /"kind"/ },
	{ name: "reference-empty-sources", lint: [], check: [] },
	{
		name: "two-projects",
		lint: [],
		check: [
			["project-multiple", "platform.md"],
			["project-multiple", "project.md"],
		],
	},
	{ name: "project-in-subdir", lint: [], check: [["project-not-at-root", "modules/project.md"]] },
	{ name: "no-project", lint: [], check: [["project-missing", ""]] },
	{
		name: "project-multiple-nested",
		lint: [],
		check: [
			["project-multiple", "modules/project.md"],
			["project-not-at-root", "modules/project.md"],
			["project-multiple", "project.md"],
		],
	},
];

describe("software-project clean fixture", () => {
	it.effect(
		"loads with the expected shape and zero conformance and lint diagnostics under the merged config (P-37)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* load("software-project");
				assert.strictEqual(bundle.files.length, 23);
				assert.strictEqual(bundle.concepts.size, 11);
				assert.strictEqual(bundle.indexes.size, 11);
				assert.strictEqual(bundle.logs.size, 1);
				assert.deepStrictEqual(bundle.directories, [
					"",
					"conventions",
					"decisions",
					"glossary",
					"gotchas",
					"interfaces",
					"limitations",
					"models",
					"modules",
					"references",
					"runbooks",
				]);
				assert.strictEqual(bundle.indexes.get("")?.okfVersion, "0.2");
				const report = Validate.all(bundle, merged);
				assert.deepStrictEqual(report.conformance, []);
				assert.deepStrictEqual(codes(report.lint), []);
				assert.deepStrictEqual(profile.check(bundle), []);
			}),
	);

	it.effect("holds one concept of every layout type, under its layout directory", () =>
		Effect.gen(function* () {
			const bundle = yield* load("software-project");
			const byType = new Map([...bundle.concepts.values()].map((c): [string, string] => [c.frontmatter.type, c.path])); // (checked) tuple annotation for the Map constructor
			assert.strictEqual(byType.get("Project"), "project.md");
			for (const { directory, type } of profile.layout.directories) {
				const path = byType.get(type);
				assert.isDefined(path, type);
				assert.isTrue(path?.startsWith(`${directory}/`), `${type} under ${directory}/`);
				assert.isTrue(bundle.indexes.has(directory), `index for ${directory}`);
			}
		}),
	);
});

describe("software-project bad fixtures", () => {
	for (const bad of BAD_CASES) {
		it.effect(`bad/${bad.name}: lint ${JSON.stringify(bad.lint)}; check ${JSON.stringify(bad.check)}`, () =>
			Effect.gen(function* () {
				const bundle = yield* load(`bad/${bad.name}`);
				const report = Validate.all(bundle, merged);
				assert.deepStrictEqual(report.conformance, []);
				assert.deepStrictEqual(codes(report.lint), bad.lint);
				assert.isTrue(report.lint.every((d) => d.severity === "error"));
				if (bad.message !== undefined) assert.match(report.lint[0]?.message ?? "", bad.message);
				const found = profile.check(bundle);
				assert.deepStrictEqual(codes(found), bad.check);
				for (const d of found) {
					assert.strictEqual(d.severity, "error");
					assert.isFalse("range" in d);
				}
			}),
		);
	}

	it.effect("project-multiple names the other Projects; project-missing is bundle-level", () =>
		Effect.gen(function* () {
			const two = profile.check(yield* load("bad/two-projects"));
			assert.match(two[0]?.message ?? "", /"platform\.md" is one of 2; .*others: project\.md\)$/); // (checked) matches decision 5's `; ` and the closing paren
			assert.match(two[1]?.message ?? "", /"project\.md" is one of 2; .*others: platform\.md\)$/); // (checked)
			const none = profile.check(yield* load("bad/no-project"));
			assert.strictEqual(none[0]?.file, "");
			assert.match(none[0]?.message ?? "", /No Project concept .*project\.md/);
			const nested = profile.check(yield* load("bad/project-in-subdir"));
			assert.match(nested[0]?.message ?? "", /"modules\/project\.md" is below the bundle root/);
		}),
	);

	it.effect("check is independent of lint: a bundle failing lint still passes check and vice versa", () =>
		Effect.gen(function* () {
			const lintOnly = yield* load("bad/module-no-kind");
			assert.deepStrictEqual(profile.check(lintOnly), []);
			assert.strictEqual(Validate.lint(lintOnly, merged).length, 1);
			const checkOnly = yield* load("bad/no-project");
			assert.deepStrictEqual(Validate.lint(checkOnly, merged), []);
			assert.strictEqual(profile.check(checkOnly).length, 1);
		}),
	);
});
