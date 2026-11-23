import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { Actor } from "../src/Actor.js";
import { Bundle, LoadedBundle, LoadedConcept } from "../src/Bundle.js";
import { Concept } from "../src/Concept.js";
import { ConceptId } from "../src/ConceptId.js";
import { Derive } from "../src/Derive.js";
import { Verification } from "../src/Verification.js";
import { conceptWithRaw, conceptWithStaleAfter, conceptWithStatus } from "./utils/conceptBuilders.js";
import { MOUNT, platform as memPlatform } from "./utils/fixtures.js";
import { platformFor } from "./utils/lintFixtures.js";

type ConceptInput = Parameters<typeof Concept.make>[0];
const actor = Schema.decodeUnknownSync(Actor);
const at = DateTime.makeUnsafe("2026-06-30T14:00:00Z");
const metric = (fields: Omit<ConceptInput, "type" | "extensions" | "raw">): Concept =>
	Concept.make({ type: "Metric", extensions: {}, raw: {}, ...fields });
const verifiedBy = (by: string): Verification => Verification.make({ by: actor(by), at });
const platform = platformFor("lint/bundle", "/repo/bundle");
const loadBundle = Effect.provide(Bundle.load({ root: "/repo/bundle" }), platform);

const emptyDocument = Result.getOrThrow(MarkdownDocument.parseResult(""));

const staleConcept = (id: string, staleAfter?: string): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(id)),
		path: `${id}.md`,
		frontmatter: Concept.make({
			type: "Decision",
			extensions: {},
			raw: {},
			...(staleAfter === undefined ? {} : { stale_after: DateTime.makeUnsafe(staleAfter) }),
		}),
		document: emptyDocument,
		computationBody: Option.none(),
	});

const bundleOf = (...concepts: ReadonlyArray<LoadedConcept>): LoadedBundle =>
	LoadedBundle.make({
		root: "/tmp/bundle",
		files: concepts.map((c) => c.path),
		directories: [""],
		concepts: new Map(concepts.map((c) => [c.id, c])),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
	});

describe("Derive", () => {
	it.effect("trustTier follows OKF 5.3", () =>
		Effect.sync(() => {
			assert.strictEqual(Derive.trustTier(metric({})), "unverified");
			assert.strictEqual(Derive.trustTier(metric({ verified: [] })), "unverified");
			const machine = metric({
				verified: [verifiedBy("process:nightly"), verifiedBy("reference_agent/gemini-2.5-pro")],
			});
			assert.strictEqual(Derive.trustTier(machine), "machine-confirmed");
			assert.strictEqual(Derive.trustTier(metric({ verified: [verifiedBy("team:finance-fpa")] })), "machine-confirmed");
			const human = metric({ verified: [verifiedBy("process:nightly"), verifiedBy("human:jsmith@acme")] });
			assert.strictEqual(Derive.trustTier(human), "human-reviewed");
		}),
	);

	it.effect("status defaults to stable", () =>
		Effect.sync(() => {
			assert.strictEqual(Derive.status(metric({})), "stable");
			assert.strictEqual(Derive.status(metric({ status: "deprecated" })), "deprecated");
		}),
	);

	it.effect("staleness and isStale compare now against stale_after inclusively", () =>
		Effect.sync(() => {
			const staleAfter = DateTime.makeUnsafe("2026-12-31T00:00:00Z");
			const concept = metric({ stale_after: staleAfter });
			assert.strictEqual(Derive.staleness(metric({}), staleAfter), "unknown");
			assert.strictEqual(Derive.staleness(concept, DateTime.makeUnsafe("2026-12-30T23:59:59Z")), "fresh");
			assert.strictEqual(Derive.staleness(concept, staleAfter), "stale");
			assert.isFalse(Derive.isStale(metric({}), staleAfter));
			assert.isTrue(Derive.isStale(concept, DateTime.makeUnsafe("2027-01-01T00:00:00Z")));
		}),
	);

	it.effect(
		"status: an unknown value reads unknown and keeps its raw text; null and empty read stable (OKF 0.3 §5.4, D3)",
		() =>
			Effect.sync(() => {
				const archived = conceptWithRaw({ status: "archived" });
				assert.strictEqual(Derive.status(archived), "unknown");
				assert.strictEqual(Derive.rawStatus(archived), "archived");
				assert.strictEqual(Derive.status(conceptWithRaw({ status: 5 })), "unknown");
				assert.strictEqual(Derive.rawStatus(conceptWithRaw({ status: 5 })), "5");
				assert.strictEqual(Derive.status(conceptWithRaw({ status: null })), "stable");
				assert.strictEqual(Derive.status(conceptWithRaw({ status: "" })), "stable");
				assert.strictEqual(Derive.status(conceptWithRaw({ status: [] })), "stable");
				assert.isUndefined(Derive.rawStatus(conceptWithRaw({ status: [] })));
				assert.strictEqual(Derive.status(conceptWithRaw({})), "stable");
				assert.isUndefined(Derive.rawStatus(conceptWithRaw({})));
				assert.strictEqual(Derive.status(conceptWithStatus("deprecated")), "deprecated");
			}),
	);

	it.effect("staleness: an unparsable stale_after is malformed, never fresh and never stale (OKF 0.3 §5.5, D4)", () =>
		Effect.sync(() => {
			const now = DateTime.makeUnsafe("2026-07-01T00:00:00Z");
			const bad = conceptWithRaw({ stale_after: "next tuesday" });
			assert.strictEqual(Derive.staleness(bad, now), "malformed");
			assert.isFalse(Derive.isStale(bad, now));
			assert.strictEqual(Derive.staleness(conceptWithRaw({ stale_after: null }), now), "unknown");
			assert.strictEqual(Derive.staleness(conceptWithRaw({ stale_after: [] }), now), "unknown");
			assert.strictEqual(Derive.staleness(conceptWithRaw({ stale_after: "" }), now), "unknown");
			assert.strictEqual(Derive.staleness(conceptWithStaleAfter("2026-06-01T00:00:00Z"), now), "stale");
		}),
	);

	it.effect("title falls back to the file name", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			const misc = [...bundle.concepts.values()].find((c) => c.path === "notes/misc.md");
			assert.strictEqual(misc === undefined ? undefined : Derive.title(misc), "misc");
		}),
	);

	it.effect("renderIndex groups by type, sorts, folds descriptions, adds subdirectories and okf_version", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			const all = [...bundle.concepts.values()];
			assert.strictEqual(
				Derive.renderIndex("", all),
				[
					"# Decision\n",
					"* [Use pnpm](decisions/adr-1.md) - Package manager choice.\n",
					"# Module\n",
					"* [Core](modules/core.md) - The core package.",
					"* [Web](modules/web.md) - The website, served from packages/web.\n",
					"# Note\n",
					"* [misc](notes/misc.md)\n",
				].join("\n"),
			);
			const modules = all.filter((c) => c.path.startsWith("modules/"));
			assert.strictEqual(
				Derive.renderIndex("modules", modules, { okfVersion: "0.2", subdirectories: ["z", "a"] }),
				"---\nokf_version: '0.2'\n---\n\n# Module\n\n* [Core](core.md) - The core package.\n* [Web](web.md) - The website, served from packages/web.\n\n# Subdirectories\n\n* [a](a/index.md)\n* [z](z/index.md)\n",
			);
			assert.strictEqual(Derive.renderIndex("modules", []), "");
		}),
	);

	it.effect(
		"renderIndex re-emits existing root frontmatter byte for byte and adds okf_version only when none is declared (D6)",
		() =>
			Effect.sync(() => {
				const revenue = LoadedConcept.make({
					id: Option.getOrThrow(ConceptId.normalize("revenue")),
					path: "revenue.md",
					frontmatter: metric({ title: "Revenue" }),
					document: emptyDocument,
					computationBody: Option.none(),
				});
				const declared =
					'okf_version: "0.3"   # declared\ntitle:   Acme retail analytics\nx-acme-owner: { team: finance }';
				const kept = Derive.renderIndex("", [revenue], { okfVersion: "0.2", frontmatter: declared });
				assert.isTrue(kept.startsWith(`---\n${declared}\n---\n\n# `));
				const bare = "title: Acme\nlicense: CC-BY-4.0";
				assert.match(
					Derive.renderIndex("", [revenue], { okfVersion: "0.3", frontmatter: bare }),
					/^---\nokf_version: ['"]0\.3['"]\ntitle: Acme\nlicense: CC-BY-4\.0\n---\n\n# /,
				);
				assert.isTrue(Derive.renderIndex("", [revenue], { frontmatter: bare }).startsWith(`---\n${bare}\n---\n\n# `));
				// control: no frontmatter keeps today's okf_version-only block
				assert.match(
					Derive.renderIndex("", [revenue], { okfVersion: "0.2" }),
					/^---\nokf_version: ['"]0\.2['"]\n---\n\n# /,
				);
				// control: an empty string is absent
				assert.match(
					Derive.renderIndex("", [revenue], { okfVersion: "0.2", frontmatter: "" }),
					/^---\nokf_version: ['"]0\.2['"]\n---\n\n# /,
				);
			}),
	);

	it.effect("renderIndex over a loaded root index keeps the source's text before its first heading (D6)", () =>
		Effect.gen(function* () {
			const declared =
				'okf_version: "0.3"   # declared\ntitle:   Acme retail analytics\nx-acme-owner: { team: finance }';
			const source = `---\n${declared}\n---\n\n# Metric\n\n* [Revenue](revenue.md)\n`;
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(
					memPlatform({
						[`${MOUNT}/index.md`]: source,
						[`${MOUNT}/revenue.md`]: "---\ntype: Metric\ntitle: Revenue\n---\n\nBody.\n",
					}),
				),
			);
			const frontmatter = bundle.indexes.get("")?.frontmatter;
			assert.strictEqual(frontmatter, declared);
			const rendered = Derive.renderIndex("", [...bundle.concepts.values()], {
				...(frontmatter === undefined ? {} : { frontmatter }),
			});
			assert.strictEqual(rendered.slice(0, rendered.indexOf("# ")), source.slice(0, source.indexOf("# ")));
		}),
	);

	it.effect("renderIndex escapes markdown-active characters in title and description (issue #72)", () =>
		Effect.sync(() => {
			const concept = LoadedConcept.make({
				id: Option.getOrThrow(ConceptId.normalize("weird")),
				path: "weird.md",
				frontmatter: metric({
					title: "<Weird> *Title*",
					description: "Point resource at <pkg>/src",
				}),
				document: emptyDocument,
				computationBody: Option.none(),
			});
			assert.strictEqual(
				Derive.renderIndex("", [concept]),
				"# Metric\n\n* [\\<Weird> \\*Title\\*](weird.md) - Point resource at \\<pkg>/src\n",
			);
		}),
	);

	it.effect("renderLogEntry renders a date heading and starred items", () =>
		Effect.sync(() => {
			const text = Derive.renderLogEntry({ date: "2026-09-04", items: ["**Update**: one.", "**Verified** two."] });
			assert.strictEqual(text, "## 2026-09-04\n\n* **Update**: one.\n* **Verified** two.\n");
			assert.strictEqual(Derive.renderLogEntry({ date: "2026-09-04", items: [] }), "## 2026-09-04\n\n");
		}),
	);

	it.effect("synthesizeIndex lists concepts directly in dir plus immediate child directories, no frontmatter", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			assert.strictEqual(
				Derive.synthesizeIndex(bundle, ""),
				"# Subdirectories\n\n* [decisions](decisions/index.md)\n* [modules](modules/index.md)\n* [notes](notes/index.md)\n",
			);
			assert.strictEqual(Derive.synthesizeIndex(bundle, "notes"), "# Note\n\n* [misc](misc.md)\n");
		}),
	);
});

describe("Derive.renderLog", () => {
	it("renders just the title heading for an empty group list", () => {
		assert.strictEqual(Derive.renderLog([]), "# Log\n");
	});

	it("renders one group under the default title, joined title-then-body with one blank line", () => {
		const rendered = Derive.renderLog([{ date: "2026-09-04", items: ["Added a thing."] }]);
		assert.strictEqual(rendered, "# Log\n\n## 2026-09-04\n\n* Added a thing.\n");
	});

	it("joins multiple groups with exactly one blank line between their rendered text", () => {
		const rendered = Derive.renderLog([
			{ date: "2026-09-05", items: ["Added second."] },
			{ date: "2026-09-04", items: ["Added first."] },
		]);
		assert.strictEqual(rendered, "# Log\n\n## 2026-09-05\n\n* Added second.\n\n## 2026-09-04\n\n* Added first.\n");
	});

	it("accepts a custom title", () => {
		const rendered = Derive.renderLog([{ date: "2026-09-04", items: [] }], { title: "Changes" });
		assert.strictEqual(rendered, "# Changes\n\n## 2026-09-04\n\n");
	});
});

describe("Derive.staleReport", () => {
	it.effect("staleReport returns [] for an empty bundle", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(Derive.staleReport(bundleOf(), DateTime.makeUnsafe("2026-09-06T00:00:00Z")), []);
		}),
	);

	it.effect("staleReport excludes a concept with no stale_after", () =>
		Effect.sync(() => {
			const bundle = bundleOf(staleConcept("a"));
			assert.deepStrictEqual(Derive.staleReport(bundle, DateTime.makeUnsafe("2026-09-06T00:00:00Z")), []);
		}),
	);

	it.effect("staleReport excludes a concept whose stale_after is in the future", () =>
		Effect.sync(() => {
			const bundle = bundleOf(staleConcept("a", "2027-01-01T00:00:00Z"));
			assert.deepStrictEqual(Derive.staleReport(bundle, DateTime.makeUnsafe("2026-09-06T00:00:00Z")), []);
		}),
	);

	it.effect("staleReport includes a concept exactly at its stale_after with daysPast 0", () =>
		Effect.sync(() => {
			const bundle = bundleOf(staleConcept("a", "2026-09-06T00:00:00Z"));
			const report = Derive.staleReport(bundle, DateTime.makeUnsafe("2026-09-06T00:00:00Z"));
			assert.strictEqual(report.length, 1);
			assert.strictEqual(report[0]?.id, "a");
			assert.strictEqual(report[0]?.daysPast, 0);
		}),
	);

	it.effect("staleReport reports daysPast as whole elapsed days", () =>
		Effect.sync(() => {
			const bundle = bundleOf(staleConcept("a", "2026-09-06T00:00:00Z"));
			const report = Derive.staleReport(bundle, DateTime.makeUnsafe("2026-09-16T12:00:00Z"));
			assert.strictEqual(report[0]?.daysPast, 10);
		}),
	);

	it.effect("staleReport sorts by id ascending regardless of map insertion order", () =>
		Effect.sync(() => {
			const bundle = bundleOf(
				staleConcept("z/last", "2020-01-01T00:00:00Z"),
				staleConcept("a/first", "2020-01-01T00:00:00Z"),
				staleConcept("m/middle", "2020-01-01T00:00:00Z"),
			);
			const ids = Derive.staleReport(bundle, DateTime.makeUnsafe("2026-09-06T00:00:00Z")).map((entry) => entry.id);
			assert.deepStrictEqual(ids, ["a/first", "m/middle", "z/last"]);
		}),
	);

	it.effect("staleReport returns exactly the stale concept from a mixed bundle", () =>
		Effect.sync(() => {
			const bundle = bundleOf(
				staleConcept("stale", "2020-01-01T00:00:00Z"),
				staleConcept("fresh", "2099-01-01T00:00:00Z"),
				staleConcept("undated"),
			);
			const report = Derive.staleReport(bundle, DateTime.makeUnsafe("2026-09-06T00:00:00Z"));
			assert.strictEqual(report.length, 1);
			assert.strictEqual(report[0]?.id, "stale");
		}),
	);
});
