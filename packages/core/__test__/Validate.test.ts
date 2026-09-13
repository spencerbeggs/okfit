import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { Bundle, LoadedBundle } from "../src/Bundle.js";
import { Diagnostic } from "../src/Diagnostic.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { platformFor } from "./utils/lintFixtures.js";

const platform = platformFor("lint/bundle", "/repo/bundle");
const loadBundle = Effect.provide(Bundle.load({ root: "/repo/bundle" }), platform);
const escapePlatform = platformFor("lint/escape-bundle", "/repo/escape-bundle");
const loadEscapeBundle = Effect.provide(Bundle.load({ root: "/repo/escape-bundle" }), escapePlatform);
const draftPlatform = platformFor("lint/draft-bundle", "/repo/draft-bundle");
const loadDraftBundle = Effect.provide(Bundle.load({ root: "/repo/draft-bundle" }), draftPlatform);
const now = DateTime.makeUnsafe("2026-09-04T00:00:00Z");

const vocabConfig: OkfitConfig = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	concepts: { required: ["title"] },
	types: {
		Module: {
			required: ["resource", "kind"],
			fields: { kind: { description: "Kind.", values: { package: "npm package", website: "Docs site" } } },
		},
		Decision: { require_verified: true },
	},
	extensions: { legacy_key: true },
});

const summary = (diagnostics: ReadonlyArray<Diagnostic>): ReadonlyArray<[string, string, string]> =>
	diagnostics.map((d) => [d.code, d.file, d.severity]);

const emptyBundle = (diagnostics: ReadonlyArray<Diagnostic>): LoadedBundle =>
	LoadedBundle.make({
		root: "/repo/x",
		files: [],
		directories: [],
		concepts: new Map(),
		indexes: new Map(),
		logs: new Map(),
		diagnostics,
	});

describe("Validate", () => {
	it.effect("conformance keeps conformance codes; lint re-severities load-time lint codes and drops off", () =>
		Effect.sync(() => {
			const bundle = emptyBundle([
				Diagnostic.make({ file: "a.md", code: "frontmatter-missing", severity: "error", message: "m" }),
				Diagnostic.make({ file: "b.md", code: "legacy-timestamp", severity: "info", message: "m" }),
				Diagnostic.make({ file: "c/log.md", code: "log-frontmatter", severity: "warning", message: "m" }),
			]);
			assert.deepStrictEqual(summary(Validate.conformance(bundle)), [["frontmatter-missing", "a.md", "error"]]);
			const raised = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
				lint: { legacy_timestamp: "error", log_frontmatter: "off" },
				extensions: {},
			});
			assert.deepStrictEqual(summary(Validate.lint(bundle, raised)), [["legacy-timestamp", "b.md", "error"]]);
			assert.deepStrictEqual(summary(Validate.lint(bundle, OkfitConfig.DEFAULTS)), [
				["legacy-timestamp", "b.md", "info"],
				["log-frontmatter", "c/log.md", "warning"],
			]);
		}),
	);

	it.effect("every rule fires on the fixture bundle under the vocab config", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			const report = Validate.all(bundle, vocabConfig, { now });
			assert.deepStrictEqual(report.conformance, []);
			assert.deepStrictEqual(summary(report.lint), [
				["config-unknown-key", "", "warning"],
				["unknown-type", "notes/misc.md", "error"],
				["required-key-missing", "modules/core.md", "error"],
				["required-key-missing", "notes/misc.md", "error"],
				["field-value-unknown", "modules/web.md", "error"],
				["require-verified-unmet", "decisions/adr-1.md", "error"],
				["actor-prefix-unknown", "decisions/adr-1.md", "info"],
				["footnote-source-unknown", "decisions/adr-1.md", "warning"],
				["footnote-undefined", "decisions/adr-1.md", "warning"],
				["broken-links", "modules/web.md", "warning"],
				["missing-index", "modules/index.md", "warning"],
				["stale", "decisions/adr-1.md", "info"],
			]);
			const byCode = (code: string) => report.lint.filter((d) => d.code === code);
			assert.match(byCode("required-key-missing")[0]?.message ?? "", /"resource"/);
			assert.match(byCode("required-key-missing")[1]?.message ?? "", /"title"/);
			assert.match(byCode("field-value-unknown")[0]?.message ?? "", /"blog".*package, website/);
			assert.match(byCode("broken-links")[0]?.message ?? "", /"missing\.md"/);
			assert.match(byCode("stale")[0]?.message ?? "", /2026-01-01T00:00:00/);
			const adr = [...bundle.concepts.values()].find((c) => c.path === "decisions/adr-1.md");
			const footnote = byCode("footnote-source-unknown")[0]?.range;
			const span =
				adr === undefined || footnote === undefined
					? undefined
					: adr.document.source.slice(footnote.offset, footnote.offset + footnote.length);
			assert.strictEqual(span, "[^unknown]");
			const undefinedRange = byCode("footnote-undefined")[0]?.range;
			assert.match(byCode("footnote-undefined")[0]?.message ?? "", /"unknown".*no \[\^unknown\]: definition/);
			assert.deepStrictEqual(undefinedRange, footnote);
			assert.isDefined(byCode("broken-links")[0]?.range);
			assert.isDefined(byCode("unknown-type")[0]?.range);
			assert.isUndefined(byCode("missing-index")[0]?.range);
		}),
	);

	it.effect("stale needs now; unknown-type is off without types; required keys default to none", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			assert.deepStrictEqual(summary(Validate.lint(bundle, OkfitConfig.DEFAULTS)), [
				["actor-prefix-unknown", "decisions/adr-1.md", "info"],
				["footnote-source-unknown", "decisions/adr-1.md", "warning"],
				["footnote-undefined", "decisions/adr-1.md", "warning"],
				["broken-links", "modules/web.md", "warning"],
				["missing-index", "modules/index.md", "warning"],
			]);
		}),
	);

	it.effect("broken-links does not fire for a resource that escapes the bundle root (F-18)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadEscapeBundle;
			const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS);
			assert.deepStrictEqual(summary(lint), [["broken-links", "modules/gone.md", "warning"]]);
			assert.match(lint[0]?.message ?? "", /"missing\.md"/);
		}),
	);

	it.effect("require-verified-unmet skips a draft concept and still fires on a stable one (issue #31)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadDraftBundle;
			assert.deepStrictEqual(summary(Validate.lint(bundle, vocabConfig)), [
				["config-unknown-key", "", "warning"],
				["require-verified-unmet", "decisions/settled.md", "error"],
				["footnote-undefined", "decisions/settled.md", "warning"],
			]);
		}),
	);

	it.effect(
		"footnote-undefined fires on a declared source with no definition line, where footnote-source-unknown is silent (issue #32)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* loadDraftBundle;
				const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS);
				assert.deepStrictEqual(summary(lint), [["footnote-undefined", "decisions/settled.md", "warning"]]);
				assert.match(lint[0]?.message ?? "", /"spec"/);
				assert.isDefined(lint[0]?.range);
			}),
	);

	it.effect("off silences every rule", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			const silent = OkfitConfig.merge(vocabConfig, {
				lint: {
					config_unknown_key: "off",
					unknown_type: "off",
					required_key_missing: "off",
					field_value_unknown: "off",
					require_verified_unmet: "off",
					actor_prefix_unknown: "off",
					footnote_source_unknown: "off",
					footnote_undefined: "off",
					broken_links: "off",
					missing_index: "off",
					stale: "off",
				},
				extensions: {},
			});
			assert.deepStrictEqual(Validate.lint(bundle, silent, { now }), []);
		}),
	);
});
