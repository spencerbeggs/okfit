import { assert, describe, it } from "@effect/vitest";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, ConceptId, Graph, OkfVersion, OkfitConfig, Validate } from "@okfit/core";
import { Profiles } from "@okfit/profiles";
import { DateTime, Effect, Option } from "effect";
import { lintResources } from "../src/validate/resources.js";
import type { ErrorCase, ProjectSeed } from "./fixtures/bundles.js";
import { ERROR_PROJECTS, UNDECLARED_PROJECT, V02_PROJECT, V03_PROJECT } from "./fixtures/bundles.js";
import { ROOT, projectPlatform } from "./utils/bundle.js";

const load = (seed: ProjectSeed) => Bundle.load({ root: ROOT }).pipe(Effect.provide(projectPlatform(seed)));
const codes = (bundle: LoadedBundle) => bundle.diagnostics.map((d) => [d.file, d.code]);

describe("fixture bundles (R1b)", () => {
	it.effect("V03_PROJECT declares 0.3, has no root fallback and loads clean apart from README.md", () =>
		Effect.gen(function* () {
			const bundle = yield* load(V03_PROJECT);
			assert.deepStrictEqual(OkfVersion.declared(bundle), Option.some("0.3"));
			assert.isFalse(OkfVersion.legacyFallbacks(bundle));
			assert.strictEqual(bundle.indexes.get("")?.title, "Acme retail analytics");
			assert.deepStrictEqual(codes(bundle), [["README.md", "frontmatter-missing"]]);
			assert.deepStrictEqual(Graph.fromBundle(bundle).dangling(), []);
		}),
	);

	it.effect("V02_PROJECT and UNDECLARED_PROJECT resolve their bare paths only through the root fallback", () =>
		Effect.gen(function* () {
			for (const seed of [V02_PROJECT, UNDECLARED_PROJECT]) {
				const bundle = yield* load(seed);
				assert.isTrue(OkfVersion.legacyFallbacks(bundle));
				assert.deepStrictEqual(Graph.fromBundle(bundle).dangling(), []);
			}
			// control: the same bare paths under a 0.3 declaration dangle
			const strict = yield* load(ERROR_PROJECTS["bare-path-under-0.3"]);
			assert.strictEqual(Graph.fromBundle(strict).dangling().length, 2);
		}),
	);
});

describe("ERROR_PROJECTS: one defect each", () => {
	const lintOf = (bundle: LoadedBundle) =>
		Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code !== "missing-index");
	const loadsClean = (name: ErrorCase) =>
		Effect.gen(function* () {
			const bundle = yield* load(ERROR_PROJECTS[name]);
			return { bundle, codes: codes(bundle) };
		});
	const README = ["README.md", "frontmatter-missing"];

	it.effect("unknown-status yields value-unknown on the one concept", () =>
		Effect.gen(function* () {
			const { codes } = yield* loadsClean("unknown-status");
			assert.deepStrictEqual(codes, [README, ["metrics/margin.md", "value-unknown"]]);
		}),
	);
	it.effect("malformed-stale-after yields value-malformed on the one concept", () =>
		Effect.gen(function* () {
			const { codes } = yield* loadsClean("malformed-stale-after");
			assert.deepStrictEqual(codes, [README, ["metrics/margin.md", "value-malformed"]]);
		}),
	);
	it.effect(
		"empty-required-title is required-key-missing (empty) under the software-project config; the clean seed has none",
		() =>
			Effect.gen(function* () {
				const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, Profiles.softwareProject.config);
				assert.isTrue(merged.concepts?.required?.includes("title"));
				const requiredOf = (bundle: LoadedBundle) =>
					Validate.lint(bundle, merged)
						.filter((d) => d.code === "required-key-missing")
						.map((d) => [d.file, d.message]);
				const { bundle } = yield* loadsClean("empty-required-title");
				assert.deepStrictEqual(requiredOf(bundle), [["metrics/margin.md", 'Required key "title" is empty']]);
				const clean = yield* load(V03_PROJECT);
				assert.deepStrictEqual(requiredOf(clean), []);
			}),
	);
	it.effect("non-concept-unlisted follows the software-project list: README.md silent, notes.md fires once", () =>
		Effect.gen(function* () {
			const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, Profiles.softwareProject.config);
			const unlisted = (bundle: LoadedBundle) =>
				Validate.lint(bundle, merged)
					.filter((d) => d.code === "non-concept-unlisted")
					.map((d) => d.file);
			assert.deepStrictEqual(unlisted(yield* load(V03_PROJECT)), []);
			const withNotes = yield* load({ ...V03_PROJECT, "okf/notes.md": "# Notes\n" });
			assert.deepStrictEqual(unlisted(withNotes), ["notes.md"]);
			// control: the load diagnostic for the listed README is still there (R46)
			assert.isTrue(withNotes.diagnostics.some((d) => d.file === "README.md" && d.code === "frontmatter-missing"));
		}),
	);
	it.effect("the software-project list matches the §3.2 names at any depth and nothing else", () =>
		Effect.gen(function* () {
			const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, Profiles.softwareProject.config);
			const files = ["README.md", "docs/a/README.md", "AGENTS.md", "skills/x/SKILL.md", "CONTRIBUTING.md"];
			const bad = ["notes.md", "readme.md", "docs/README.markdown.md"];
			const seed = Object.fromEntries([...files, ...bad].map((f) => [`okf/${f}`, "# Plain\n"]));
			const bundle = yield* load({ ...V03_PROJECT, ...seed });
			const fired = Validate.lint(bundle, merged)
				.filter((d) => d.code === "non-concept-unlisted")
				.map((d) => d.file)
				.sort();
			assert.deepStrictEqual(fired, [...bad].sort());
		}),
	);
	it.effect("unparsable-version yields index-metadata-invalid on the root index", () =>
		Effect.gen(function* () {
			const { codes } = yield* loadsClean("unparsable-version");
			assert.deepStrictEqual(codes, [README, ["index.md", "index-metadata-invalid"]]);
		}),
	);
	it.effect("superseded-by-unresolved yields broken-links from lint; the clean seed yields none", () =>
		Effect.gen(function* () {
			const { bundle } = yield* loadsClean("superseded-by-unresolved");
			assert.deepStrictEqual(
				lintOf(bundle).map((d) => [d.file, d.code]),
				[
					[README[0], "frontmatter-missing"],
					["metrics/margin-legacy.md", "broken-links"],
				],
			);
			// one defect, one diagnostic: the missing target is not also superseded-by-unresolved
			assert.isFalse(lintOf(bundle).some((d) => d.code === "superseded-by-unresolved"));
			const clean = yield* load(V03_PROJECT);
			assert.isFalse(lintOf(clean).some((d) => d.code === "broken-links"));
			assert.isFalse(lintOf(clean).some((d) => d.code.startsWith("superseded-by")));
		}),
	);
	it.effect("superseded-by-orphan yields superseded-by-orphan on margin-legacy; the clean seed yields none", () =>
		Effect.gen(function* () {
			const { bundle } = yield* loadsClean("superseded-by-orphan");
			assert.deepStrictEqual(
				lintOf(bundle)
					.filter((d) => d.code.startsWith("superseded-by"))
					.map((d) => [d.file, d.code]),
				[["metrics/margin-legacy.md", "superseded-by-orphan"]],
			);
		}),
	);
	it.effect(
		"verified-before-change loads with generated.at later than its one event; the clean seed has no generated",
		() =>
			Effect.gen(function* () {
				const { bundle, codes } = yield* loadsClean("verified-before-change");
				assert.deepStrictEqual(codes, [README]);
				const frontmatter = bundle.concepts.get(ConceptId.make("metrics/revenue"))?.frontmatter;
				const generated = frontmatter?.generated?.at;
				const events = frontmatter?.verified ?? [];
				assert.lengthOf(events, 1);
				if (generated === undefined) return assert.fail("generated.at must be present");
				assert.isTrue(DateTime.isGreaterThan(generated, events[0]?.at ?? generated));
				// the seed carries no integrity block: a binding is written only by a real runVerify
				assert.isUndefined(frontmatter?.raw.integrity);
				const clean = yield* load(V03_PROJECT);
				assert.isUndefined(clean.concepts.get(ConceptId.make("metrics/revenue"))?.frontmatter.generated);
				// the lint fires once on the seed, at the one concept; the clean seed is the control
				const found = (b: LoadedBundle) => lintOf(b).filter((d) => d.code === "verified-before-change");
				assert.deepStrictEqual(
					found(bundle).map((d) => d.file),
					["metrics/revenue.md"],
				);
				assert.deepStrictEqual(found(clean), []);
			}),
	);
	// Later tasks define the expectation for these; today each loads with only the README note.
	for (const name of ["empty-required-title", "resource-outside-project", "resource-missing-in-repository"] as const) {
		it.effect(`${name} loads and carries its one defect`, () =>
			Effect.gen(function* () {
				const { codes } = yield* loadsClean(name);
				assert.deepStrictEqual(codes, [README]);
			}),
		);
	}
	// The one path each case changes against its base (`bare-path-under-0.3` is the V02 control).
	const CHANGED: Readonly<Record<ErrorCase, readonly [ProjectSeed, string]>> = {
		"unknown-status": [V03_PROJECT, "okf/metrics/margin.md"],
		"malformed-stale-after": [V03_PROJECT, "okf/metrics/margin.md"],
		"superseded-by-orphan": [V03_PROJECT, "okf/metrics/margin-legacy.md"],
		"superseded-by-unresolved": [V03_PROJECT, "okf/metrics/margin-legacy.md"],
		"empty-required-title": [V03_PROJECT, "okf/metrics/margin.md"],
		"resource-outside-project": [V03_PROJECT, "okf/modules/widget.md"],
		"resource-missing-in-repository": [V03_PROJECT, "packages/widget/README.md"],
		"bare-path-under-0.3": [V02_PROJECT, "okf/index.md"],
		"unparsable-version": [V03_PROJECT, "okf/index.md"],
		"verified-before-change": [V03_PROJECT, "okf/metrics/revenue.md"],
	};
	it("each case differs from its base by exactly the named change", () => {
		const diff = (a: ProjectSeed, b: ProjectSeed) =>
			[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
		for (const name of Object.keys(ERROR_PROJECTS) as ErrorCase[]) {
			const [base, path] = CHANGED[name];
			assert.deepStrictEqual(diff(ERROR_PROJECTS[name], base), [path], name);
		}
		// control: the helper does report a difference
		assert.deepStrictEqual(diff({ a: "1" }, { a: "2" }), ["a"]);
	});
});

describe("ERROR_PROJECTS: repository resources", () => {
	const lintOf = (name: "resource-outside-project" | "resource-missing-in-repository") =>
		Effect.gen(function* () {
			const bundle = yield* load(ERROR_PROJECTS[name]);
			return (yield* lintResources(bundle, OkfitConfig.DEFAULTS, "/repo")).map((d) => [d.file, d.code, d.severity]);
		}).pipe(Effect.provide(projectPlatform(ERROR_PROJECTS[name])));

	it.effect("resource-outside-project is reported as info, never as missing", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* lintOf("resource-outside-project"), [
				["modules/widget.md", "resource-outside-project", "info"],
			]);
		}),
	);
	it.effect("resource-missing-in-repository is source-resource-missing", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* lintOf("resource-missing-in-repository"), [
				["modules/widget.md", "source-resource-missing", "warning"],
			]);
		}),
	);
});
