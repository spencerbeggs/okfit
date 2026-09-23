import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { DateTime, Effect, Layer, Path } from "effect";
import type { Actor } from "../src/Actor.js";
import { Bundle, LoadedBundle } from "../src/Bundle.js";
import { Diagnostic } from "../src/Diagnostic.js";
import { frontmatterPathRange } from "../src/internal/frontmatter.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { platformFor } from "./utils/lintFixtures.js";

/** Builds a `LoadedBundle` from an in-memory `{ relativePath: markdown }` map (D-37). */
const loadFromSources = (sources: Record<string, string>) => {
	const mount = "/repo/generated-missing";
	const seed: Record<string, string> = {};
	for (const [relative, content] of Object.entries(sources)) {
		seed[`${mount}/${relative}`] = content;
	}
	const platform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);
	return Effect.provide(Bundle.load({ root: mount }), platform);
};

const platform = platformFor("lint/bundle", "/repo/bundle");
const loadBundle = Effect.provide(Bundle.load({ root: "/repo/bundle" }), platform);
const escapePlatform = platformFor("lint/escape-bundle", "/repo/escape-bundle");
const loadEscapeBundle = Effect.provide(Bundle.load({ root: "/repo/escape-bundle" }), escapePlatform);
const draftPlatform = platformFor("lint/draft-bundle", "/repo/draft-bundle");
const loadDraftBundle = Effect.provide(Bundle.load({ root: "/repo/draft-bundle" }), draftPlatform);
const anchorsPlatform = platformFor("lint/anchors-bundle", "/repo/anchors-bundle");
const loadAnchorsBundle = Effect.provide(Bundle.load({ root: "/repo/anchors-bundle" }), anchorsPlatform);
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

const statusConfig: OkfitConfig = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	lint: { status_missing: "warn" },
	extensions: {},
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

			// decision 2: each rule anchors at the value it complains about, never the key.
			const misc = [...bundle.concepts.values()].find((c) => c.path === "notes/misc.md");
			const unknownTypeRange = byCode("unknown-type")[0]?.range;
			assert.isDefined(misc);
			assert.isDefined(unknownTypeRange);
			assert.strictEqual(
				misc!.document.source.slice(unknownTypeRange!.offset, unknownTypeRange!.offset + unknownTypeRange!.length),
				"Note",
			);

			const web = [...bundle.concepts.values()].find((c) => c.path === "modules/web.md");
			const fieldValueRange = byCode("field-value-unknown")[0]?.range;
			assert.isDefined(web);
			assert.isDefined(fieldValueRange);
			assert.strictEqual(
				web!.document.source.slice(fieldValueRange!.offset, fieldValueRange!.offset + fieldValueRange!.length),
				"blog",
			);

			assert.isDefined(adr);
			const actorRange = byCode("actor-prefix-unknown")[0]?.range;
			assert.isDefined(actorRange);
			assert.strictEqual(
				adr!.document.source.slice(actorRange!.offset, actorRange!.offset + actorRange!.length),
				"team:platform",
			);

			const staleRange = byCode("stale")[0]?.range;
			assert.isDefined(staleRange);
			assert.strictEqual(
				adr!.document.source.slice(staleRange!.offset, staleRange!.offset + staleRange!.length),
				"2026-01-01T00:00:00Z",
			);

			// require-verified-unmet anchors at `status`, but adr-1.md has no status key, so it falls
			// back to the frontmatter block (decision 2's absent-key rule); positive control beside it:
			// actor-prefix-unknown on the same concept resolves a precise, non-block range.
			const requireVerifiedRange = byCode("require-verified-unmet")[0]?.range;
			const blockRange = frontmatterPathRange(adr!.document, []);
			assert.deepStrictEqual(requireVerifiedRange, blockRange);
			assert.notDeepEqual(actorRange, blockRange);
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

	it.effect(
		"status-missing fires when neither status nor verified is present, and is off by default (issue #110)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* loadDraftBundle;
				const lint = Validate.lint(bundle, statusConfig).filter((d) => d.code === "status-missing");
				assert.deepStrictEqual(summary(lint), [["status-missing", "decisions/settled.md", "warning"]]);
				assert.match(lint[0]?.message ?? "", /reads as stable/);
				assert.isDefined(lint[0]?.range);
				assert.deepStrictEqual(
					Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "status-missing"),
					[],
				);
			}),
	);

	it.effect("status-missing is silent on a concept that carries verified but no status (issue #110)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadAnchorsBundle;
			const audited = [...bundle.concepts.values()].find((c) => c.path === "modules/audited.md");
			assert.isUndefined(audited?.frontmatter.status);
			assert.strictEqual(audited?.frontmatter.verified?.length, 1);
			assert.deepStrictEqual(
				Validate.lint(bundle, statusConfig).filter((d) => d.code === "status-missing"),
				[],
			);
		}),
	);

	describe("generated-missing (issue #73)", () => {
		const withAgent = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
			actors: { agent: "okfit/claude-code" as Actor, humans: [] },
			extensions: {},
		});

		it.effect("warns when actors.agent is configured and a concept has no generated block", () =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"modules/core.md": "---\ntype: Module\ntitle: Core\n---\n\n# Core\n",
				});
				const diagnostics = Validate.lint(bundle, withAgent);
				const hit = diagnostics.filter((d) => d.code === "generated-missing");
				assert.strictEqual(hit.length, 1);
				assert.strictEqual(hit[0]?.severity, "warning");
				assert.strictEqual(hit[0]?.file, "modules/core.md");
				assert.match(hit[0]?.message ?? "", /okfit sync will create it from actors\.agent/);
			}),
		);

		it.effect("is silent when actors.agent is not configured, whatever the concept carries", () =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"modules/core.md": "---\ntype: Module\ntitle: Core\n---\n\n# Core\n",
				});
				const diagnostics = Validate.lint(bundle, OkfitConfig.DEFAULTS);
				assert.deepStrictEqual(
					diagnostics.filter((d) => d.code === "generated-missing"),
					[],
				);
			}),
		);

		it.effect("is silent when the concept already carries generated.by", () =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"modules/core.md": "---\ntype: Module\ntitle: Core\ngenerated:\n  by: human:ada\n---\n\n# Core\n",
				});
				const diagnostics = Validate.lint(bundle, withAgent);
				assert.deepStrictEqual(
					diagnostics.filter((d) => d.code === "generated-missing"),
					[],
				);
			}),
		);

		it.effect("respects lint.generated_missing = off", () =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"modules/core.md": "---\ntype: Module\ntitle: Core\n---\n\n# Core\n",
				});
				const config = OkfitConfig.merge(withAgent, { lint: { generated_missing: "off" }, extensions: {} });
				const diagnostics = Validate.lint(bundle, config);
				assert.deepStrictEqual(
					diagnostics.filter((d) => d.code === "generated-missing"),
					[],
				);
			}),
		);
	});

	it.effect("footnote-undefined ignores footnote-shaped text inside code spans and fences (issue #67)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadAnchorsBundle;
			const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "footnote-undefined");
			assert.deepStrictEqual(summary(lint), [["footnote-undefined", "modules/web.md", "warning"]]);
			assert.match(lint[0]?.message ?? "", /"baz"/);
		}),
	);

	it.effect("broken-links checks a #fragment against the target's heading slugs (issue #69)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadAnchorsBundle;
			const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "broken-links");
			assert.deepStrictEqual(summary(lint), [
				["broken-links", "modules/web.md", "warning"],
				["broken-links", "modules/web.md", "warning"],
				["broken-links", "modules/web.md", "warning"],
			]);
			const messages = lint.map((d) => d.message);
			assert.match(messages[0] ?? "", /"missing\.md#whatever" does not exist/);
			assert.match(messages[1] ?? "", /"store\.md#no-such-heading" exists but has no heading "#no-such-heading"/);
			assert.match(messages[2] ?? "", /"#no-such-self" exists but has no heading "#no-such-self"/);
			assert.isDefined(lint[1]?.range);
			assert.isDefined(lint[2]?.range);
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
