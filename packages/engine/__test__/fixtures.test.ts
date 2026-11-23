import { assert, describe, it } from "@effect/vitest";
import type { LoadedBundle } from "@okfit/core";
import { Bundle, Graph, OkfVersion, OkfitConfig, Validate } from "@okfit/core";
import { Effect, Option } from "effect";
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
			const clean = yield* load(V03_PROJECT);
			assert.isFalse(lintOf(clean).some((d) => d.code === "broken-links"));
		}),
	);
	// Later tasks define the expectation for these; today each loads with only the README note.
	for (const name of [
		"superseded-by-orphan",
		"empty-required-title",
		"resource-outside-project",
		"resource-missing-in-repository",
	] as const) {
		it.effect(`${name} loads and carries its one defect`, () =>
			Effect.gen(function* () {
				const { codes } = yield* loadsClean(name);
				assert.deepStrictEqual(codes, [README]);
				assert.notDeepEqual(ERROR_PROJECTS[name], V03_PROJECT);
			}),
		);
	}
	it("each case differs from its base by exactly the named change", () => {
		const diff = (a: ProjectSeed, b: ProjectSeed) =>
			[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
		assert.deepStrictEqual(diff(ERROR_PROJECTS["resource-missing-in-repository"], V03_PROJECT), [
			"packages/widget/README.md",
		]);
		assert.deepStrictEqual(diff(ERROR_PROJECTS["unknown-status"], V03_PROJECT), ["okf/metrics/margin.md"]);
		assert.deepStrictEqual(diff(ERROR_PROJECTS["resource-outside-project"], V03_PROJECT), ["okf/modules/widget.md"]);
	});
});
