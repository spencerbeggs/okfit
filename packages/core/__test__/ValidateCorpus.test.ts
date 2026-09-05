import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { Diagnostic } from "../src/Diagnostic.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { platformFor } from "./utils/lintFixtures.js";

type BundleName = "acme_retail" | "crypto_bitcoin" | "ga4" | "stackoverflow";
const layers = {
	acme_retail: platformFor("okf/acme_retail", "/repo/acme_retail"),
	crypto_bitcoin: platformFor("okf/crypto_bitcoin", "/repo/crypto_bitcoin"),
	ga4: platformFor("okf/ga4", "/repo/ga4"),
	stackoverflow: platformFor("okf/stackoverflow", "/repo/stackoverflow"),
};
const load = (name: BundleName) => Effect.provide(Bundle.load({ root: `/repo/${name}` }), layers[name]);
const codes = (diagnostics: ReadonlyArray<Diagnostic>): ReadonlyArray<string> =>
	diagnostics.map((d) => `${d.code} ${d.file}`);
const future = DateTime.makeUnsafe("2100-01-01T00:00:00Z");
const past = DateTime.makeUnsafe("2000-01-01T00:00:00Z");

const STACKOVERFLOW_FOOTNOTE_FILES = [
	"references/content_licenses.md",
	"references/joins/comments__posts.md",
	"references/joins/post_links__posts.md",
	"references/joins/posts__votes.md",
	"references/joins/posts_answers__posts_questions.md",
	"references/metrics/accepted_answer_rate.md",
	"references/metrics/bad_question_flag_ratio.md",
	"references/post_types.md",
	"references/vote_types.md",
	"tables/posts_questions.md",
	"tables/votes.md",
];

describe("Validate over the upstream bundles", () => {
	it.effect("acme_retail: conformant; log-frontmatter only; 7 stale in the far future", () =>
		Effect.gen(function* () {
			const bundle = yield* load("acme_retail");
			const report = Validate.all(bundle, OkfitConfig.DEFAULTS);
			assert.deepStrictEqual(report.conformance, []);
			assert.deepStrictEqual(codes(report.lint), ["log-frontmatter log.md"]);
			assert.deepStrictEqual(codes(Validate.lint(bundle, OkfitConfig.DEFAULTS, { now: past })), [
				"log-frontmatter log.md",
			]);
			const stale = Validate.lint(bundle, OkfitConfig.DEFAULTS, { now: future }).filter((d) => d.code === "stale");
			assert.strictEqual(stale.length, 7);
			assert.isTrue(stale.every((d) => d.severity === "info" && d.message.includes("2026-12-31T00:00:00")));
		}),
	);

	it.effect("crypto_bitcoin and ga4: no findings at all", () =>
		Effect.gen(function* () {
			for (const name of ["crypto_bitcoin", "ga4"] as const) {
				const report = Validate.all(yield* load(name), OkfitConfig.DEFAULTS, { now: future });
				assert.deepStrictEqual(report.conformance, [], name);
				assert.deepStrictEqual(report.lint, [], name);
			}
		}),
	);

	it.effect("stackoverflow: eleven numeric footnote labels match no source id", () =>
		Effect.gen(function* () {
			const report = Validate.all(yield* load("stackoverflow"), OkfitConfig.DEFAULTS, { now: future });
			assert.deepStrictEqual(report.conformance, []);
			assert.deepStrictEqual(
				[...codes(report.lint)].sort(),
				STACKOVERFLOW_FOOTNOTE_FILES.map((file) => `footnote-source-unknown ${file}`),
			);
			assert.isTrue(report.lint.every((d) => d.severity === "warning" && d.message.includes('"1"')));
		}),
	);
});
