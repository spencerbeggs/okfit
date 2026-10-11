import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Actor, Concept, ConceptId, DiagnosticRange, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Crypto, DateTime, Effect, Layer, Option, Result, Schema } from "effect";
import { Derivation } from "../src/Derivation.js";
import { Trust } from "../src/Trust.js";

const FRONTMATTER_OPTIONS = MarkdownParseOptions.make({ frontmatter: true });
const AT = "2026-03-01T00:00:00Z";
const LATER = "2026-04-01T00:00:00Z";
const NOW = DateTime.makeUnsafe("2026-06-01T00:00:00Z");
const BODY = "\nBody.\n";

/** NodeCrypto with `digest` replaced by a defect: any hashing attempt fails the test. */
const noHashing = Layer.effect(
	Crypto.Crypto,
	Effect.map(Crypto.Crypto, (real) => ({ ...real, digest: () => Effect.die("hashed") })),
).pipe(Layer.provide(NodeCrypto.layer));

const decode = Schema.decodeUnknownSync(Concept);

/** Builds a loaded concept; flow YAML (`JSON.stringify` per value) is valid YAML. */
const concept = (
	fm: Record<string, unknown>,
	body = BODY,
	path = "note.md",
	rawExtra: Record<string, bigint> = {},
): LoadedConcept => {
	const yaml = [
		...Object.entries(fm).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
		...Object.entries(rawExtra).map(([key, value]) => `${key}: ${value.toString()}`),
	].join("\n");
	const source = `---\n${yaml}\n---${body}`;
	return LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize(path)),
		path,
		frontmatter: decode({ ...fm, extensions: {}, raw: { ...fm, ...rawExtra } }),
		document: Result.getOrThrow(MarkdownDocument.parseResult(source, FRONTMATTER_OPTIONS)),
		computationBody: Option.none(),
	});
};

const bundleOf = (...concepts: ReadonlyArray<LoadedConcept>): LoadedBundle =>
	LoadedBundle.make({
		root: "/okf",
		files: concepts.map((c) => c.path),
		directories: [""],
		concepts: new Map(concepts.map((c) => [c.id, c])),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
	});

const digestOf = (c: LoadedConcept) => Derivation.contentDigest(c.frontmatter.raw, c.document.source);

/** A concept bound to its own current content by `human:spencer` at `AT`. */
const bound = (extra: Record<string, unknown> = {}, body = BODY) =>
	Effect.gen(function* () {
		const base = { type: "Decision", verified: [{ by: "human:spencer", at: AT }], ...extra };
		const content = yield* digestOf(concept(base, body));
		return {
			base,
			content,
			concept: concept({ ...base, integrity: { verified: { by: "human:spencer", at: AT, content } } }, body),
		};
	});

describe("Trust.signal", () => {
	it.effect("no human entry -> none", () =>
		Effect.gen(function* () {
			const c = concept({ type: "Decision", verified: [{ by: "process:nightly", at: AT }] });
			const signal = yield* Trust.signal(c, NOW);
			assert.deepStrictEqual(signal, { tier: "machine-confirmed", integrity: "none", stale: false });
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("bound and unchanged -> current", () =>
		Effect.gen(function* () {
			const base = { type: "Decision", verified: [{ by: "human:spencer", at: AT }] };
			const probe = concept(base);
			const content = yield* Derivation.contentDigest(probe.frontmatter.raw, probe.document.source);
			const boundConcept = concept({ ...base, integrity: { verified: { by: "human:spencer", at: AT, content } } });
			const signal = yield* Trust.signal(boundConcept, NOW);
			assert.deepStrictEqual(signal, { tier: "human-reviewed", integrity: "current", stale: false });
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("legacy entry without integrity -> drifted/unbound", () =>
		Effect.gen(function* () {
			const c = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] });
			const signal = yield* Trust.signal(c, NOW);
			assert.deepStrictEqual(signal, {
				tier: "human-reviewed",
				integrity: "drifted",
				drift: { reason: "unbound" },
				stale: false,
			});
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("body edited -> drifted/content-changed, editedBy from a later generated", () =>
		Effect.gen(function* () {
			const { base, content } = yield* bound();
			const edited = concept(
				{
					...base,
					generated: { by: "agent/x", at: LATER },
					integrity: { verified: { by: "human:spencer", at: AT, content } },
				},
				"\nA different body.\n",
			);
			const signal = yield* Trust.signal(edited, NOW);
			assert.deepStrictEqual<unknown>(signal, {
				tier: "human-reviewed",
				integrity: "drifted",
				drift: { reason: "content-changed", editedBy: "agent/x", editedAt: LATER },
				stale: false,
			});
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("body edited without a later generated -> content-changed with no editor", () =>
		Effect.gen(function* () {
			const { base, content } = yield* bound();
			const edited = concept(
				{ ...base, integrity: { verified: { by: "human:spencer", at: AT, content } } },
				"\nA different body.\n",
			);
			const signal = yield* Trust.signal(edited, NOW);
			assert.deepStrictEqual(signal.drift, { reason: "content-changed" });
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("later human entry not named by binding -> drifted/entry-superseded", () =>
		Effect.gen(function* () {
			const { content } = yield* bound();
			const c = concept({
				type: "Decision",
				verified: [
					{ by: "human:spencer", at: AT },
					{ by: "human:ada", at: LATER },
				],
				integrity: { verified: { by: "human:spencer", at: AT, content } },
			});
			const signal = yield* Trust.signal(c, NOW);
			assert.strictEqual(signal.integrity, "drifted");
			assert.deepStrictEqual(signal.drift, { reason: "entry-superseded" });
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("machine entry after the bound human entry stays current", () =>
		Effect.gen(function* () {
			const base = {
				type: "Decision",
				verified: [
					{ by: "human:spencer", at: AT },
					{ by: "process:nightly", at: LATER },
				],
			};
			const content = yield* digestOf(concept(base));
			const c = concept({ ...base, integrity: { verified: { by: "human:spencer", at: AT, content } } });
			const signal = yield* Trust.signal(c, NOW);
			assert.strictEqual(signal.integrity, "current");
			assert.strictEqual(signal.tier, "human-reviewed");
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("status and stale_after changes stay current", () =>
		Effect.gen(function* () {
			const { content } = yield* bound();
			const c = concept({
				type: "Decision",
				status: "draft",
				stale_after: "2030-01-01T00:00:00Z",
				verified: [{ by: "human:spencer", at: AT }],
				integrity: { verified: { by: "human:spencer", at: AT, content } },
			});
			const signal = yield* Trust.signal(c, NOW);
			assert.strictEqual(signal.integrity, "current");
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("stale flag follows stale_after vs now", () =>
		Effect.gen(function* () {
			const past = concept({ type: "Note", stale_after: "2026-01-01T00:00:00Z" });
			const future = concept({ type: "Note", stale_after: "2027-01-01T00:00:00Z" });
			const none = concept({ type: "Note" });
			assert.isTrue((yield* Trust.signal(past, NOW)).stale);
			assert.isFalse((yield* Trust.signal(future, NOW)).stale);
			assert.isFalse((yield* Trust.signal(none, NOW)).stale);
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});

describe("Trust.signals", () => {
	it.effect("maps every concept id to its signal", () =>
		Effect.gen(function* () {
			const a = concept({ type: "Note" }, BODY, "a.md");
			const b = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] }, BODY, "b.md");
			const signals = yield* Trust.signals(bundleOf(a, b), NOW);
			assert.strictEqual(signals.size, 2);
			assert.strictEqual(signals.get(a.id)?.integrity, "none");
			assert.strictEqual(signals.get(b.id)?.integrity, "drifted");
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});

describe("Trust.lint", () => {
	it.effect("emits verified-drift warning for drifted, nothing for current/none", () =>
		Effect.gen(function* () {
			const { concept: current } = yield* bound();
			const drifted = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] }, BODY, "drifted.md");
			const none = concept({ type: "Note" }, BODY, "none.md");
			const diagnostics = yield* Trust.lint(bundleOf(current, drifted, none), OkfitConfig.DEFAULTS, NOW);
			assert.strictEqual(diagnostics.length, 1);
			assert.strictEqual(diagnostics[0]?.code, "verified-drift");
			assert.strictEqual(diagnostics[0]?.severity, "warning");
			assert.strictEqual(diagnostics[0]?.file, "drifted.md");
			assert.isDefined(diagnostics[0]?.range);
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("a drifted draft or deprecated concept lints nothing while its signal still says drifted", () =>
		Effect.gen(function* () {
			const draft = concept(
				{ type: "Decision", status: "draft", verified: [{ by: "human:spencer", at: AT }] },
				BODY,
				"draft.md",
			);
			const deprecated = concept(
				{ type: "Decision", status: "deprecated", verified: [{ by: "human:spencer", at: AT }] },
				BODY,
				"deprecated.md",
			);
			for (const c of [draft, deprecated]) {
				assert.strictEqual((yield* Trust.signal(c, NOW)).integrity, "drifted");
			}
			assert.deepStrictEqual(yield* Trust.lint(bundleOf(draft, deprecated), OkfitConfig.DEFAULTS, NOW), []);
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("a drifted stable concept still warns, with explicit and absent status", () =>
		Effect.gen(function* () {
			const explicit = concept(
				{ type: "Decision", status: "stable", verified: [{ by: "human:spencer", at: AT }] },
				BODY,
				"explicit.md",
			);
			const absent = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] }, BODY, "absent.md");
			const diagnostics = yield* Trust.lint(bundleOf(explicit, absent), OkfitConfig.DEFAULTS, NOW);
			assert.deepStrictEqual(diagnostics.map((d) => d.file).sort(), ["absent.md", "explicit.md"]);
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("a bigint frontmatter value (an integer beyond 2^53) lints instead of defecting", () =>
		Effect.gen(function* () {
			const fm = { type: "Decision", verified: [{ by: "human:spencer", at: AT }] };
			const rawExtra = { ticket: 123456789012345678901n };
			const content = yield* digestOf(concept(fm, BODY, "big.md", rawExtra));
			const current = concept(
				{ ...fm, integrity: { verified: { by: "human:spencer", at: AT, content } } },
				BODY,
				"big.md",
				rawExtra,
			);
			assert.strictEqual((yield* Trust.signal(current, NOW)).integrity, "current");
			const changed = concept(
				{ ...fm, integrity: { verified: { by: "human:spencer", at: AT, content } } },
				BODY,
				"big.md",
				{ ticket: 123456789012345678902n },
			);
			const diagnostics = yield* Trust.lint(bundleOf(current, changed), OkfitConfig.DEFAULTS, NOW);
			assert.strictEqual(diagnostics.length, 1);
			assert.include(diagnostics[0]?.message ?? "", "content changed since");
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("an unbound drift ranges at the latest human verified entry, not the whole key", () =>
		Effect.gen(function* () {
			const c = concept({
				type: "Decision",
				verified: [
					{ by: "human:ada", at: AT },
					{ by: "human:spencer", at: LATER },
					{ by: "process:nightly", at: LATER },
				],
			});
			const [diagnostic] = yield* Trust.lint(bundleOf(c), OkfitConfig.DEFAULTS, NOW);
			const entry = DiagnosticRange.forFrontmatterPath(c.document, ["verified", 1]);
			assert.isDefined(entry);
			assert.deepStrictEqual(diagnostic?.range, entry);
			assert.notDeepEqual(diagnostic?.range, DiagnosticRange.forFrontmatterPath(c.document, ["verified"]));
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);

	it.effect("off severity returns [] without hashing", () =>
		Effect.gen(function* () {
			const drifted = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] });
			const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, { extensions: {}, lint: { verified_drift: "off" } });
			// A Crypto whose every member dies: a hash attempt would defect the test.
			const diagnostics = yield* Trust.lint(bundleOf(drifted), config, NOW);
			assert.deepStrictEqual(diagnostics, []);
		}).pipe(Effect.provide(noHashing)),
	);

	it.effect("message names the reason and the editor", () =>
		Effect.gen(function* () {
			const { base, content } = yield* bound();
			const edited = concept(
				{
					...base,
					generated: { by: "agent/x", at: LATER },
					integrity: { verified: { by: "human:spencer", at: AT, content } },
				},
				"\nA different body.\n",
			);
			const [diagnostic] = yield* Trust.lint(bundleOf(edited), OkfitConfig.DEFAULTS, NOW);
			const message = diagnostic?.message ?? "";
			assert.include(message, "content changed since human:spencer verified it at");
			assert.include(message, `edited by agent/x at ${LATER}`);
			assert.include(message, "re-run okfit verify");

			const legacy = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] });
			const [unbound] = yield* Trust.lint(bundleOf(legacy), OkfitConfig.DEFAULTS, NOW);
			assert.include(unbound?.message ?? "", "no integrity.verified binding records what was verified");
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});

describe("Trust.evaluate (pure: no Crypto provided)", () => {
	const at = DateTime.makeUnsafe(AT);
	const later = DateTime.makeUnsafe(LATER);
	const actor = Schema.decodeSync(Actor);
	const human = (name: string, when: DateTime.Utc) => ({ by: actor(`human:${name}`), at: when });
	const binding = (content: string) => ({ by: actor("human:spencer"), at, content });
	const base: Parameters<typeof Trust.evaluate>[0] = {
		verified: [human("spencer", at)],
		binding: binding("abc"),
		generated: undefined,
	};

	it("no human entry -> none", () => {
		const input = { ...base, verified: [{ by: actor("process:nightly"), at }] };
		assert.deepStrictEqual(Trust.evaluate(input, undefined), { integrity: "none" });
		assert.isFalse(Trust.needsDigest(input));
	});

	it("no binding -> drifted/unbound", () => {
		const input = { ...base, binding: undefined };
		assert.deepStrictEqual(Trust.evaluate(input, undefined), { integrity: "drifted", drift: { reason: "unbound" } });
		assert.isFalse(Trust.needsDigest(input));
	});

	it("the binding names an older entry -> drifted/entry-superseded", () => {
		const input = { ...base, verified: [human("spencer", at), human("ada", later)] };
		assert.deepStrictEqual(Trust.evaluate(input, undefined), {
			integrity: "drifted",
			drift: { reason: "entry-superseded" },
		});
		assert.isFalse(Trust.needsDigest(input));
	});

	it("digest equal -> current; digest differs -> content-changed", () => {
		assert.isTrue(Trust.needsDigest(base));
		assert.deepStrictEqual(Trust.evaluate(base, "abc"), { integrity: "current" });
		assert.deepStrictEqual(Trust.evaluate(base, "xyz"), {
			integrity: "drifted",
			drift: { reason: "content-changed" },
		});
	});

	it("content-changed carries editedBy/editedAt only when generated.at is after the binding", () => {
		const after = { ...base, generated: { by: actor("agent/x"), at: later } };
		assert.deepStrictEqual<unknown>(Trust.evaluate(after, "xyz"), {
			integrity: "drifted",
			drift: { reason: "content-changed", editedBy: "agent/x", editedAt: LATER },
		});
		const before = { ...base, generated: { by: actor("agent/x"), at: DateTime.makeUnsafe("2026-01-01T00:00:00Z") } };
		assert.deepStrictEqual(Trust.evaluate(before, "xyz").drift, { reason: "content-changed" });
	});

	it("a bound entry evaluated without a digest is a programming error", () => {
		assert.throws(() => Trust.evaluate(base, undefined));
	});
});

describe("Trust.signal parity with evaluate", () => {
	it.effect("signal equals { tier, stale, ...evaluate(inputOf, digest) } for every fixture", () =>
		Effect.gen(function* () {
			const { concept: current } = yield* bound();
			const fixtures = [
				concept({ type: "Note" }),
				concept({ type: "Decision", verified: [{ by: "process:nightly", at: AT }] }),
				concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] }),
				current,
				concept({ ...current.frontmatter.raw, generated: { by: "agent/x", at: LATER } }, "\nChanged.\n"),
			];
			for (const c of fixtures) {
				const input = Trust.inputOf(c);
				const digest = Trust.needsDigest(input) ? yield* digestOf(c) : undefined;
				const got = yield* Trust.signal(c, NOW);
				const expected = {
					tier: got.tier,
					stale: got.stale,
					...Trust.evaluate(input, digest),
				};
				assert.deepStrictEqual<unknown>(got, expected);
			}
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});

describe("Trust.lint given signals", () => {
	it.effect("reuses the given signals and never hashes", () =>
		Effect.gen(function* () {
			const { concept: current } = yield* bound();
			const drifted = concept({ type: "Decision", verified: [{ by: "human:spencer", at: AT }] }, BODY, "drifted.md");
			const bundle = bundleOf(current, drifted);
			const signals = yield* Trust.signals(bundle, NOW).pipe(Effect.provide(NodeCrypto.layer));
			const diagnostics = yield* Trust.lint(bundle, OkfitConfig.DEFAULTS, NOW, signals).pipe(Effect.provide(noHashing));
			assert.strictEqual(diagnostics.length, 1);
			assert.strictEqual(diagnostics[0]?.file, "drifted.md");
		}).pipe(Effect.provide(NodeCrypto.layer)),
	);
});
