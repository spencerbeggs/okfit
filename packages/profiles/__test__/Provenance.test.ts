import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { Git, NotARepositoryError } from "@effected/git";
import { MarkdownDocument } from "@effected/markdown";
import { Actor, Concept, ConceptId, Generated, LoadedBundle, LoadedConcept, OkfitConfig, Timestamp } from "@okfit/core";
import type { Crypto } from "effect";
import { DateTime, Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { Derivation } from "../src/Derivation.js";
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

const conceptWith = (generated?: Generated, source?: string): LoadedConcept =>
	LoadedConcept.make({
		id: conceptId,
		path: REL,
		frontmatter: Concept.make({
			type: "Module",
			extensions: {},
			raw: {},
			...(generated === undefined ? {} : { generated }),
		}),
		document: source === undefined ? emptyDocument : Result.getOrThrow(MarkdownDocument.parseResult(source)),
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
const noGit: Layer.Layer<Git | GitHistory | FileSystem.FileSystem | Path.Path | Crypto.Crypto> = Layer.mergeAll(
	Git.layerTest({}),
	GitHistory.layerTest({}),
	FileSystem.layerNoop({}),
	Path.layer,
	NodeCrypto.layer,
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
			assert.strictEqual(result[0]?.severity, "warning");
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

	describe("tier 1: generated.body_sha256 present (issue #19)", () => {
		const SOURCE = "---\ntype: Module\ntitle: Digested\n---\n\n# Digested\n\nBody text.\n";
		const OTHER_SOURCE = "---\ntype: Module\ntitle: Digested\n---\n\n# Digested\n\nA different body.\n";
		const digestOf = (source: string) => Effect.provide(Derivation.bodyDigest(source), NodeCrypto.layer);

		it.effect(
			"is silent when the digest matches the current body, with no git call at all",
			() =>
				Effect.gen(function* () {
					const digest = yield* digestOf(SOURCE);
					const generated = Generated.make({
						by: actor("human:okfit-test"),
						at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"), // deliberately stale; tier 1 never looks at `at`
						body_sha256: digest,
					});
					const result = yield* Provenance.lint(bundleOf(conceptWith(generated, SOURCE)), OkfitConfig.DEFAULTS);
					assert.deepStrictEqual(result, []);
				}).pipe(Effect.provide(noGit)), // dies on any Git/GitHistory/FileSystem call, proving tier 1 never touches them
		);

		it.effect("reports when the digest no longer matches the current body", () =>
			Effect.gen(function* () {
				const staleDigest = yield* digestOf(SOURCE);
				const currentDigest = yield* digestOf(OTHER_SOURCE);
				const generated = Generated.make({ by: actor("human:okfit-test"), body_sha256: staleDigest });
				const result = yield* Provenance.lint(bundleOf(conceptWith(generated, OTHER_SOURCE)), OkfitConfig.DEFAULTS);
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0]?.code, "generated-at-drift");
				assert.include(result[0]?.message ?? "", "the body has changed since generated.at was last stamped");
				assert.include(result[0]?.message ?? "", staleDigest);
				assert.include(result[0]?.message ?? "", currentDigest);
			}).pipe(Effect.provide(noGit)),
		);

		it.effect("is silent even when derived.at would differ from recorded.at (the squash case)", () =>
			Effect.gen(function* () {
				// The digest matches, so tier 1 never reaches `Derivation.generatedAt` at all -- `noGit`
				// dying on any git call is the proof: a stale `at` alongside a matching digest can never
				// surface, exactly what a squash/rebase merge that only rewrites commit dates leaves behind.
				const digest = yield* digestOf(SOURCE);
				const generated = Generated.make({
					by: actor("human:okfit-test"),
					at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
					body_sha256: digest,
				});
				const result = yield* Provenance.lint(bundleOf(conceptWith(generated, SOURCE)), OkfitConfig.DEFAULTS);
				assert.deepStrictEqual(result, []);
			}).pipe(Effect.provide(noGit)),
		);

		it.effect("reports a changed body immediately, without needing a commit (a dirty worktree)", () =>
			Effect.gen(function* () {
				// Tier 1 reads `concept.document.source`, which for a real bundle load is the worktree's
				// current bytes -- there is no git-committed state to wait for.
				const stampedAt = yield* digestOf(SOURCE);
				const generated = Generated.make({ by: actor("human:okfit-test"), body_sha256: stampedAt });
				const result = yield* Provenance.lint(bundleOf(conceptWith(generated, OTHER_SOURCE)), OkfitConfig.DEFAULTS);
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0]?.code, "generated-at-drift");
			}).pipe(Effect.provide(noGit)),
		);
	});

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

	describe("skipGitTier (S-31)", () => {
		const SOURCE = "---\ntype: Module\ntitle: Digested\n---\n\n# Digested\n\nBody text.\n";
		const OTHER_SOURCE = "---\ntype: Module\ntitle: Digested\n---\n\n# Digested\n\nA different body.\n";
		const digestOf = (source: string) => Effect.provide(Derivation.bodyDigest(source), NodeCrypto.layer);

		it.effect(
			"a concept WITH a digest whose body changed still reports, with no git call at all",
			() =>
				Effect.gen(function* () {
					const staleDigest = yield* digestOf(SOURCE);
					const generated = Generated.make({ by: actor("human:okfit-test"), body_sha256: staleDigest });
					const result = yield* Provenance.lint(bundleOf(conceptWith(generated, OTHER_SOURCE)), OkfitConfig.DEFAULTS, {
						skipGitTier: true,
					});
					assert.strictEqual(result.length, 1);
					assert.strictEqual(result[0]?.code, "generated-at-drift");
					assert.include(result[0]?.message ?? "", "the body has changed since generated.at was last stamped");
				}).pipe(Effect.provide(noGit)), // dies on any Git/GitHistory call, proving no git call happens
		);

		it.effect("a concept WITHOUT a digest is skipped entirely, with no git call at all", () =>
			Effect.gen(function* () {
				const generated = Generated.make({
					by: actor("human:okfit-test"),
					at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"), // would drift under tier 2 if it ran
				});
				const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS, {
					skipGitTier: true,
				});
				assert.deepStrictEqual(result, []);
			}).pipe(Effect.provide(noGit)),
		);

		it.effect("flag absent: unchanged behavior -- tier 2 still runs and reports drift", () =>
			Effect.gen(function* () {
				const generated = Generated.make({
					by: actor("human:okfit-test"),
					at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
				});
				const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS);
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0]?.code, "generated-at-drift");
			}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
		);

		it.effect("flag explicitly false: unchanged behavior -- tier 2 still runs and reports drift", () =>
			Effect.gen(function* () {
				const generated = Generated.make({
					by: actor("human:okfit-test"),
					at: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
				});
				const result = yield* Provenance.lint(bundleOf(conceptWith(generated)), OkfitConfig.DEFAULTS, {
					skipGitTier: false,
				});
				assert.strictEqual(result.length, 1);
				assert.strictEqual(result[0]?.code, "generated-at-drift");
			}).pipe(Effect.provide(world({ worktree: HEAD_TEXT, head: Option.some(HEAD_TEXT), blobs, history }))),
		);
	});

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
					NodeCrypto.layer,
				),
			),
		),
	);
});
