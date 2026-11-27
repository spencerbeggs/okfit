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
import { swapPlatform } from "./utils/swapPlatform.js";

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
				Diagnostic.make({ file: "a.md", code: "frontmatter-unclosed", severity: "error", message: "m" }),
				Diagnostic.make({ file: "n.md", code: "frontmatter-missing", severity: "warning", message: "m" }),
				Diagnostic.make({ file: "b.md", code: "legacy-timestamp", severity: "info", message: "m" }),
				Diagnostic.make({ file: "c/log.md", code: "log-frontmatter", severity: "warning", message: "m" }),
			]);
			assert.deepStrictEqual(summary(Validate.conformance(bundle)), [["frontmatter-unclosed", "a.md", "error"]]);
			const raised = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
				lint: { legacy_timestamp: "error", log_frontmatter: "off" },
				extensions: {},
			});
			assert.deepStrictEqual(summary(Validate.lint(bundle, raised)), [
				["frontmatter-missing", "n.md", "warning"],
				["legacy-timestamp", "b.md", "error"],
			]);
			assert.deepStrictEqual(summary(Validate.lint(bundle, OkfitConfig.DEFAULTS)), [
				["frontmatter-missing", "n.md", "warning"],
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
				"crew:platform",
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

	it.effect("missing-index also flags an ancestor directory that holds no concept, only a nested directory", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"topics/deep/a.md": "---\ntype: Note\ntitle: A\n---\n\n# A\n",
			});
			const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "missing-index");
			assert.deepStrictEqual(
				lint.map((d) => d.file),
				["topics/index.md", "topics/deep/index.md"],
			);
		}),
	);

	it.effect("an index.md that exists but did not load is not missing-index (#512)", () =>
		Effect.gen(function* () {
			const mount = "/repo/unread";
			const concept = "---\ntype: Note\ntitle: A\n---\n\n# A\n";
			const seed = {
				[`${mount}/root.md`]: concept,
				[`${mount}/index.md`]: "---\ntitle: x\n\n# X\n",
				[`${mount}/modules/a.md`]: concept,
				[`${mount}/modules/index.md`]: "---\nnot: [closed\n",
			};
			const load = (extra: Record<string, unknown>) =>
				Effect.provide(
					Bundle.load({ root: mount }),
					Layer.mergeAll(MemoryFileSystem.layerWith({ ...seed, ...extra }), Path.layer),
				);
			const bundle = yield* load({});
			assert.deepStrictEqual(
				Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "missing-index"),
				[],
			);
			assert.deepStrictEqual(
				Validate.conformance(bundle).map((d) => [d.file, d.code]),
				[
					["index.md", "frontmatter-unclosed"],
					["modules/index.md", "frontmatter-unclosed"],
				],
			);
			// control: a directory with no index.md file is still missing one
			const control = yield* load({ [`${mount}/other/b.md`]: concept });
			assert.deepStrictEqual(
				Validate.lint(control, OkfitConfig.DEFAULTS)
					.filter((d) => d.code === "missing-index")
					.map((d) => d.file),
				["other/index.md"],
			);
			// an index that links out of the bundle is not in the bundle: it is missing beside its symlink-escape
			const escaping = yield* load({
				[`${mount}/modules/index.md`]: MemoryFileSystem.symlink("/outside/index.md"),
				"/outside/index.md": "# Outside\n",
			});
			assert.deepStrictEqual(
				Validate.lint(escaping, OkfitConfig.DEFAULTS)
					.filter((d) => d.code === "missing-index" || d.code === "symlink-escape")
					.map((d) => [d.code, d.file]),
				[
					["symlink-escape", "modules/index.md"],
					["missing-index", "modules/index.md"],
				],
			);
		}),
	);

	for (const [name, index, dir] of [
		["the root", "index.md", "."],
		["a subdirectory", "modules/index.md", "modules"],
	] as const) {
		it.effect(`an index.md refused as read-changed is not missing-index: ${name} (#460)`, () => {
			const mount = "/repo/changed-index";
			const concept = "---\ntype: Note\ntitle: A\n---\n\n# A\n";
			const resave = (fs: import("effect").FileSystem.FileSystem) =>
				Effect.gen(function* () {
					const text = yield* fs.readFileString(`${mount}/${index}`);
					yield* fs.remove(`${mount}/${index}`);
					yield* fs.writeFileString(`${mount}/${index}`, text);
				});
			const [layer, trap] = swapPlatform(
				{
					[`${mount}/root.md`]: concept,
					[`${mount}/index.md`]: "# Root\n",
					[`${mount}/modules/a.md`]: concept,
					[`${mount}/modules/index.md`]: "# Modules\n",
				},
				"open",
				"after",
				`${mount}/${index}`,
				resave,
			);
			return Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: mount });
				assert.isTrue(trap.fired(), "the swap must have run");
				const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS);
				assert.deepStrictEqual(
					lint.filter((d) => d.code === "missing-index"),
					[],
					`"Directory ${dir} has no index.md" would be false`,
				);
				assert.deepStrictEqual(
					bundle.diagnostics.filter((d) => d.code === "read-changed").map((d) => d.file),
					[index],
				);
			}).pipe(Effect.provide(layer));
		});
	}

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

	it.effect(
		"status-missing is silent on an unknown status (value-unknown owns it), beside a control with no status",
		() =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"archived.md": "---\ntype: Note\nstatus: archived\n---\n\n# Archived\n",
					"bare.md": "---\ntype: Note\n---\n\n# Bare\n",
				});
				const lint = Validate.lint(bundle, statusConfig).filter((d) => d.code === "status-missing");
				assert.deepStrictEqual(summary(lint), [["status-missing", "bare.md", "warning"]]);
			}),
	);

	it.effect("value-unknown loads as a warning on the status value, follows config, and a known status has none", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"archived.md": "---\ntype: Note\nstatus: archived\n---\n\n# Archived\n",
				"draft.md": "---\ntype: Note\nstatus: draft\n---\n\n# Draft\n",
			});
			assert.deepStrictEqual(
				bundle.diagnostics.map((d) => [d.file, d.code, d.severity, d.range?.line, d.range?.character]),
				[["archived.md", "value-unknown", "warning", 2, 8]],
			);
			const unknown = (config: OkfitConfig) => Validate.lint(bundle, config).filter((d) => d.code === "value-unknown");
			assert.deepStrictEqual(summary(unknown(OkfitConfig.DEFAULTS)), [["value-unknown", "archived.md", "warning"]]);
			const off = OkfitConfig.merge(OkfitConfig.DEFAULTS, { lint: { value_unknown: "off" }, extensions: {} });
			assert.deepStrictEqual(unknown(off), []);
		}),
	);

	describe("a key written empty is absent (OKF 0.3 section 11.2 rule 1)", () => {
		const titleTags: OkfitConfig = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
			concepts: { required: ["title", "tags"] },
			extensions: {},
		});
		const requiredFound = (bundle: LoadedBundle, config: OkfitConfig) =>
			Validate.lint(bundle, config).filter((d) => d.code === "required-key-missing");

		it.effect("required-key-missing: empty keys read as empty, unwritten keys as missing, values pass", () =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"empty.md": '---\ntype: Note\ntitle: ""\ntags: []\n---\n',
					"nulled.md": "---\ntype: Note\ntitle:\ntags: [a]\n---\n",
					"gone.md": "---\ntype: Note\n---\n",
					"full.md": "---\ntype: Note\ntitle: T\ntags: [a]\n---\n",
				});
				const found = requiredFound(bundle, titleTags);
				assert.deepStrictEqual(
					found.map((d) => [d.file, d.message]),
					[
						["empty.md", 'Required key "title" is empty'],
						["empty.md", 'Required key "tags" is empty'],
						["gone.md", 'Required key "title" is missing'],
						["gone.md", 'Required key "tags" is missing'],
						["nulled.md", 'Required key "title" is empty'],
					],
				);
				assert.isTrue(found.every((d) => d.severity === "error"));
				// The control: the concept with real values reports nothing, and the rule fired for the others.
				assert.strictEqual(found.filter((d) => d.file === "full.md").length, 0);
			}),
		);

		it.effect("required-key-missing: an empty key points at its own line; a missing key at the block", () =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"empty.md": '---\ntype: Note\ntags: [a]\ntitle: ""\n---\n',
					"gone.md": "---\ntype: Note\ntags: [a]\n---\n",
				});
				const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, { concepts: { required: ["title"] }, extensions: {} });
				const found = requiredFound(bundle, config);
				const empty = found.find((d) => d.file === "empty.md");
				const gone = found.find((d) => d.file === "gone.md");
				assert.isDefined(empty);
				assert.isDefined(gone);
				const emptyDoc = [...bundle.concepts.values()].find((c) => c.path === "empty.md")?.document;
				const goneDoc = [...bundle.concepts.values()].find((c) => c.path === "gone.md")?.document;
				assert.isDefined(emptyDoc);
				assert.isDefined(goneDoc);
				if (emptyDoc === undefined || goneDoc === undefined) return;
				assert.deepStrictEqual(empty?.range, frontmatterPathRange(emptyDoc, ["title"]));
				assert.deepStrictEqual(gone?.range, frontmatterPathRange(goneDoc, []));
				// `title:` is the fourth line of the file (zero-based line 3); the block starts on line 0.
				assert.strictEqual(empty?.range?.line, 3);
				assert.notStrictEqual(gone?.range?.line, 3);
			}),
		);

		it.effect("required-key-missing: a required, value-listed key written empty gives one diagnostic (#467)", () =>
			Effect.gen(function* () {
				const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
					types: {
						Module: {
							required: ["kind"],
							fields: { kind: { description: "Kind.", values: { package: "npm package" } } },
						},
					},
					extensions: {},
				});
				const both = (kind: string) =>
					loadFromSources({ "m.md": `---\ntype: Module\nkind: ${kind}\n---\n` }).pipe(
						Effect.map((bundle) =>
							Validate.lint(bundle, config)
								.filter((d) => d.code === "required-key-missing" || d.code === "field-value-unknown")
								.map((d) => [d.code, d.message]),
						),
					);
				assert.deepStrictEqual(yield* both('""'), [["required-key-missing", 'Required key "kind" is empty']]);
				// control: a real but unlisted value is exactly one field-value-unknown
				const bogus = yield* both("bogus");
				assert.strictEqual(bogus.length, 1);
				assert.strictEqual(bogus[0]?.[0], "field-value-unknown");
			}),
		);

		it.effect("required-key-missing: whitespace, 0, false and {} are present", () =>
			Effect.gen(function* () {
				const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, { concepts: { required: ["k"] }, extensions: {} });
				for (const value of ['"  "', "0", "false", "{}"]) {
					const bundle = yield* loadFromSources({ "a.md": `---\ntype: Note\nk: ${value}\n---\n` });
					assert.deepStrictEqual(requiredFound(bundle, config), [], value);
				}
				// The control: the same key written empty is reported.
				const empty = yield* loadFromSources({ "a.md": '---\ntype: Note\nk: ""\n---\n' });
				assert.strictEqual(requiredFound(empty, config).length, 1);
			}),
		);

		it.effect("field-value-unknown: an empty value is absent (not checked); a real unknown value still is", () =>
			Effect.gen(function* () {
				const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
					types: { Module: { fields: { kind: { description: "Kind.", values: { package: "npm package" } } } } },
					extensions: {},
				});
				const found = (kind: string) =>
					loadFromSources({ "m.md": `---\ntype: Module\nkind: ${kind}\n---\n` }).pipe(
						Effect.map((bundle) => Validate.lint(bundle, config).filter((d) => d.code === "field-value-unknown")),
					);
				assert.deepStrictEqual(yield* found('""'), []);
				assert.deepStrictEqual(yield* found("[]"), []);
				assert.deepStrictEqual(yield* found("package"), []);
				assert.strictEqual((yield* found("bogus")).length, 1);
			}),
		);

		it.effect("generated-missing: an absent or unreadable generated counts as no block (#466)", () =>
			Effect.gen(function* () {
				const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
					actors: { agent: "okfit/claude-code" as Actor, humans: [] },
					extensions: {},
				});
				const hits = (frontmatter: string) =>
					loadFromSources({ "m.md": `---\ntype: Note\n${frontmatter}\n---\n` }).pipe(
						Effect.map((bundle) => Validate.lint(bundle, config).filter((d) => d.code === "generated-missing")),
					);
				const missing =
					/^Concept has no generated block; okfit sync will create it from actors\.agent \(okfit\/claude-code\)/;
				// Only an unwritten key or an untagged, unanchored plain null is something sync replaces (#466).
				for (const value of ["null", "~", ""]) {
					const found = yield* hits(`generated: ${value}`);
					assert.strictEqual(found.length, 1, value);
					assert.match(found[0]?.message ?? "", missing);
				}
				assert.match((yield* hits("tags: [a]"))[0]?.message ?? "", missing);
				// A written block the decoder ignores reads as absent, and sync cannot fill it in: `""`, `[]` and a tagged
				// or anchored null are skipped as generated-unsupported, like `{}`.
				for (const value of [
					"{}",
					"{ at: 2026-01-01T00:00:00Z }",
					"{ by: [1] }",
					"5",
					'""',
					"[]",
					"!!null",
					"!!null null",
					"&a ~",
				]) {
					const found = yield* hits(`generated: ${value}`);
					assert.strictEqual(found.length, 1, value);
					assert.strictEqual(
						found[0]?.message,
						"Concept's generated block has no readable generated.by, so it reads as absent (OKF 0.3 §5.2), and okfit sync cannot fill in a block that is written; set generated.by by hand",
						value,
					);
					assert.strictEqual(found[0]?.range?.line, 2, value);
				}
				// The load diagnostic is still reported beside it.
				const bundle = yield* loadFromSources({ "m.md": "---\ntype: Note\ngenerated: {}\n---\n" });
				assert.isTrue(Validate.lint(bundle, config).some((d) => d.code === "entry-ignored"));
				// A legacy timestamp alone: sync cannot convert it.
				const legacy = yield* hits("timestamp: 2026-01-01T00:00:00Z");
				assert.strictEqual(legacy.length, 1);
				assert.strictEqual(
					legacy[0]?.message,
					"Concept has no generated block, only a legacy timestamp, which okfit sync cannot convert; replace it with a generated block (generated.by, and generated.at from the timestamp) by hand",
				);
				assert.strictEqual(legacy[0]?.range?.line, 2);
				// `generated: null` beside a timestamp: the timestamp folds in, and sync skips it as generated-unsupported.
				const nullLegacy = yield* hits("generated: null\ntimestamp: 2026-01-01T00:00:00Z");
				assert.strictEqual(nullLegacy.length, 1);
				assert.match(nullLegacy[0]?.message ?? "", /^Concept has no generated block, only a legacy timestamp/);
				assert.strictEqual(nullLegacy[0]?.range?.line, 3);
				// Controls: a readable block is present, with or without a timestamp beside it.
				assert.strictEqual((yield* hits("generated: { by: okfit/claude-code }")).length, 0);
				assert.strictEqual((yield* hits("generated: { by: human:a }\ntimestamp: 2026-01-01T00:00:00Z")).length, 0);
			}),
		);
	});

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
				const written = yield* loadFromSources({ "m.md": "---\ntype: Note\ngenerated: {}\n---\n" });
				assert.deepStrictEqual(
					Validate.lint(written, OkfitConfig.DEFAULTS).filter((d) => d.code === "generated-missing"),
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

	it.effect(
		"footnote-undefined follows GFM: escaped markers, case-folded labels and indented definitions resolve",
		() =>
			Effect.gen(function* () {
				const bundle = yield* loadFromSources({
					"notes/a.md":
						"---\ntype: Note\ntitle: A\n---\n\n# A\n\nSee \\[^esc], [^Upper], [^ind] and [^real].\n\n[^upper]: Defined in lower case.\n\n   [^ind]: Indented definition.\n",
				});
				const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "footnote-undefined");
				assert.deepStrictEqual(summary(lint), [["footnote-undefined", "notes/a.md", "warning"]]);
				assert.match(lint[0]?.message ?? "", /"real"/);
				const range = lint[0]?.range;
				assert.strictEqual(range?.length, "[^real]".length);
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

	it.effect("broken-links checks the anchor of a path field (#463)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"new.md": "---\ntype: Note\n---\n\n# New\n\n## Real heading\n",
				"sup-bad.md": "---\ntype: Note\nstatus: deprecated\nsuperseded_by: ./new.md#missing-heading\n---\n",
				"sup-ok.md": "---\ntype: Note\nstatus: deprecated\nsuperseded_by: ./new.md#real-heading\n---\n",
				"res.md":
					"---\ntype: Note\nresource: ./new.md#nope\nsources:\n  - resource: ./new.md#nada\n  - resource: ./new.md#new\n---\n",
				"comp.md":
					"---\ntype: Attested Computation\nruntime: sql\ncomputation: ./q.sql#x\nexecutor:\n  resource: ./new.md#bad\nattester:\n  resource: ./new.md#zzz\n---\n",
				"q.sql": "",
				"log.md": "# Log\n",
				"typeless.md": "---\ntitle: t\n---\n",
				"nc.md": "---\ntype: Note\nresource: ./log.md#x\nsources:\n  - resource: ./typeless.md#x\n---\n",
			});
			const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS);
			const found = lint
				.filter((d) => d.code === "broken-links")
				.map((d) => [d.file, d.message, d.range?.line] as const);
			assert.deepStrictEqual(found, [
				[
					"comp.md",
					'executor.resource "./new.md#bad" exists but has no heading "#bad"; its headings: #new, #real-heading',
					5,
				],
				[
					"comp.md",
					'attester.resource "./new.md#zzz" exists but has no heading "#zzz"; its headings: #new, #real-heading',
					7,
				],
				["res.md", 'resource "./new.md#nope" exists but has no heading "#nope"; its headings: #new, #real-heading', 2],
				[
					"res.md",
					'sources[].resource "./new.md#nada" exists but has no heading "#nada"; its headings: #new, #real-heading',
					4,
				],
				[
					"sup-bad.md",
					'superseded_by "./new.md#missing-heading" exists but has no heading "#missing-heading"; its headings: #new, #real-heading',
					3,
				],
			]);
			// controls: a good anchor, a path to a non-concept, and a replacement with a bad anchor is not also unresolved
			assert.isFalse(found.some(([file]) => file === "sup-ok.md"));
			assert.isFalse(found.some(([, message]) => message.includes("computation")));
			// a reserved file and a typeless file are not concepts, so their anchors are never checked
			assert.isFalse(found.some(([file]) => file === "nc.md"));
			assert.isFalse(lint.some((d) => d.file === "sup-bad.md" && d.code === "superseded-by-unresolved"));
		}),
	);

	it.effect("broken-links suggests the nearest heading slug, else lists the target's headings (issue #148)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"modules/a.md":
					"---\ntype: Module\n---\n\n# A\n\n[x](b.md#blessed-shims-live-in-srcshim)\n[y](b.md#zzz)\n[z](c.md#q)\n",
				"modules/b.md": "---\ntype: Module\n---\n\n# B\n\n## Blessed shims live in src/shims\n\n## Other\n\n## Other\n",
				"modules/c.md": "---\ntype: Module\n---\n\nNo headings here.\n",
			});
			const messages = Validate.lint(bundle, OkfitConfig.DEFAULTS)
				.filter((d) => d.code === "broken-links")
				.map((d) => d.message);
			assert.include(
				messages,
				'Link target "b.md#blessed-shims-live-in-srcshim" exists but has no heading "#blessed-shims-live-in-srcshim"; did you mean "#blessed-shims-live-in-srcshims"?',
			);
			assert.include(
				messages,
				'Link target "b.md#zzz" exists but has no heading "#zzz"; its headings: #b, #blessed-shims-live-in-srcshims, #other, #other-1',
			);
			assert.include(messages, 'Link target "c.md#q" exists but has no heading "#q"; it has no headings');
		}),
	);

	it.effect("broken-links resolves fragments against github-slugger slugs (issue #361)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"modules/a.md": [
					"---\ntype: Module\n---\n\n# A\n",
					"[1](b.md#a--b) [2](b.md#foo_bar) [3](b.md#dup) [4](b.md#dup-1) [5](b.md#dup-1-1) [6](b.md#dup-2)\n",
				].join("\n"),
				"modules/b.md":
					"---\ntype: Module\n---\n\n# B\n\n## A — B\n\n## foo_bar\n\n## dup\n\n## dup\n\n## dup-1\n\n## dup\n",
			});
			const lint = Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "broken-links");
			assert.deepStrictEqual(
				lint.map((d) => d.message),
				[],
			);
		}),
	);

	it.effect("broken-links points a link written to the collapsed form at its github-slugger slug (issue #361)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"modules/a.md": "---\ntype: Module\n---\n\n# A\n\n[x](b.md#a-b)\n",
				"modules/b.md": "---\ntype: Module\n---\n\n# B\n\n## A — B\n",
			});
			const messages = Validate.lint(bundle, OkfitConfig.DEFAULTS)
				.filter((d) => d.code === "broken-links")
				.map((d) => d.message);
			assert.deepStrictEqual(messages, [
				'Link target "b.md#a-b" exists but has no heading "#a-b"; did you mean "#a--b"?',
			]);
		}),
	);

	it.effect("broken-links truncates a long heading list to five with a (+N more) count (issue #148)", () =>
		Effect.gen(function* () {
			const bundle = yield* loadFromSources({
				"modules/a.md": "---\ntype: Module\n---\n\n# A\n\n[x](d.md#zzzzzzzz)\n",
				"modules/d.md":
					"---\ntype: Module\n---\n\n# D\n\n## One\n\n## Two\n\n## Three\n\n## Four\n\n## Five\n\n## Six\n",
			});
			const messages = Validate.lint(bundle, OkfitConfig.DEFAULTS)
				.filter((d) => d.code === "broken-links")
				.map((d) => d.message);
			assert.include(
				messages,
				'Link target "d.md#zzzzzzzz" exists but has no heading "#zzzzzzzz"; its headings: #d, #one, #two, #three, #four (+2 more)',
			);
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
