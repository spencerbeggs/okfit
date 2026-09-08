import { assert, describe, it } from "@effect/vitest";
import { Git, NotARepositoryError } from "@effected/git";
import { MarkdownDocument } from "@effected/markdown";
import { Actor, Concept, ConceptId, Generated, LoadedBundle, LoadedConcept, OkfitConfig, Timestamp } from "@okfit/core";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { GitHistory } from "../src/GitHistory.js";
import { Provenance } from "../src/Provenance.js";
import { F4_ENTRIES, F4_LOG_ORDER, F4_TEXTS } from "./fixtures/history.js";
import { REL, ROOT, blobsOf, entriesOf, world } from "./utils/derivation.js";

const actor = Schema.decodeUnknownSync(Actor);
const HEAD_TEXT = F4_TEXTS.c6; // HEAD = c6: the topic commit is the winning body change (F4_EXPECTED_BODY_COMMIT_AT_HEAD)
const topic = F4_ENTRIES[F4_LOG_ORDER.indexOf("topic")]!;
const history = entriesOf(F4_ENTRIES);
const blobs = blobsOf(F4_ENTRIES);
const emptyDocument = Result.getOrThrow(MarkdownDocument.parseResult(""));
const conceptId = Option.getOrThrow(ConceptId.normalize(REL));

const conceptWith = (generated?: Generated): LoadedConcept =>
	LoadedConcept.make({
		id: conceptId,
		path: REL,
		frontmatter: Concept.make({
			type: "Module",
			extensions: {},
			raw: {},
			...(generated === undefined ? {} : { generated }),
		}),
		document: emptyDocument,
		computationBody: Option.none(),
	});

const bundleOf = (concept: LoadedConcept): LoadedBundle =>
	LoadedBundle.make({
		root: ROOT,
		files: [concept.path],
		directories: [""],
		concepts: new Map([[concept.id, concept]]),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
	});

// Every member of Git/GitHistory/FileSystem dies on any call, proving a
// scenario touches none of them (mirrors `notScripted`'s die-by-default
// posture, GitHistory.ts:117-118).
const noGit: Layer.Layer<Git | GitHistory | FileSystem.FileSystem | Path.Path> = Layer.mergeAll(
	Git.layerTest({}),
	GitHistory.layerTest({}),
	FileSystem.layerNoop({}),
	Path.layer,
);

describe("Provenance.lint", () => {
	it.effect("silent when generated.at already matches the derived instant", () =>
		Effect.gen(function* () {
			const generated = Generated.make({ by: actor("human:okfit-test"), at: DateTime.makeUnsafe(topic.authoredAt) });
			const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS);
			assert.deepStrictEqual(result, []);
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);

	it.effect("fires missing when generated is present but at is absent", () =>
		Effect.gen(function* () {
			const generated = Generated.make({ by: actor("human:okfit-test") });
			const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "generated-at-drift");
			assert.strictEqual(result[0]?.severity, "info");
			assert.strictEqual(result[0]?.file, REL);
			assert.isUndefined(result[0]?.range);
			assert.include(result[0]?.message ?? "", "generated.at is missing");
			assert.include(result[0]?.message ?? "", topic.sha.slice(0, 7));
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);

	it.effect("fires drift with the recorded and derived instants and a 7-char sha", () =>
		Effect.gen(function* () {
			const generated = Generated.make({
				by: actor("human:okfit-test"),
				at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
			});
			const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0]?.code, "generated-at-drift");
			assert.include(
				result[0]?.message ?? "",
				`generated.at is ${Schema.encodeSync(Timestamp)(DateTime.makeUnsafe("2020-01-01T00:00:00Z"))}`,
			);
			assert.include(result[0]?.message ?? "", Schema.encodeSync(Timestamp)(DateTime.makeUnsafe(topic.authoredAt)));
			assert.include(result[0]?.message ?? "", `(${topic.sha.slice(0, 7)})`);
		}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
	);

	it.effect("silent for an uncommitted body", () =>
		Effect.gen(function* () {
			const generated = Generated.make({ by: actor("human:okfit-test"), at: DateTime.makeUnsafe(topic.authoredAt) });
			const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS);
			assert.deepStrictEqual(result, []);
		}).pipe(
			Effect.provide(world({ worktree: `${HEAD_TEXT}\nAn uncommitted paragraph.\n`, head: Option.some(HEAD_TEXT) })),
		),
	);

	it.effect("silent for a concept with no generated block", () =>
		Effect.gen(function* () {
			const result = yield* Provenance.lint(bundleOf(conceptWith(undefined)), OkfitConfig.DEFAULTS);
			assert.deepStrictEqual(result, []);
		}).pipe(Effect.provide(noGit)),
	);

	it.effect("returns [] when off, without spawning git (no generated block)", () =>
		Effect.gen(function* () {
			// With no `generated` block there is nothing to derive regardless of
			// severity, so this alone doesn't distinguish S-28's total-over-off
			// gate from Judge note 3's old CLI-only gate; see the next case for
			// that.
			const config: OkfitConfig = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, generated_at_drift: "off" },
			};
			const result = yield* Provenance.lint(bundleOf(conceptWith(undefined)), config);
			assert.deepStrictEqual(result, []);
		}).pipe(Effect.provide(noGit)),
	);

	it.effect("returns [] when off, without spawning git, even for a concept that would otherwise drift (S-28)", () =>
		Effect.gen(function* () {
			// S-28: Provenance.lint is total over severity -- when the resolved
			// severity is "off" it returns [] before any per-concept work and
			// before any git call, even when the concept carries a `generated`
			// block whose recorded `at` would otherwise drift against a derived
			// instant. `noGit`'s die-on-any-call doubles prove no git spawn
			// happens; if the gate were missing, `Derivation.generatedAt` would
			// call `Git.repoRoot` and this would die instead of returning [].
			const generated = Generated.make({
				by: actor("human:okfit-test"),
				at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
			});
			const config: OkfitConfig = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, generated_at_drift: "off" },
			};
			const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), config);
			assert.deepStrictEqual(result, []);
		}).pipe(Effect.provide(noGit)),
	);

	it.effect("returns [] outside a git repository", () =>
		Effect.gen(function* () {
			const generated = Generated.make({ by: actor("human:okfit-test"), at: DateTime.makeUnsafe(topic.authoredAt) });
			const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS);
			assert.deepStrictEqual(result, []);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Git.layerTest({ repoRoot: (cwd) => Effect.fail(new NotARepositoryError({ cwd })) }),
					GitHistory.layerTest({}),
					FileSystem.layerNoop({}),
					Path.layer,
				),
			),
		),
	);
});
