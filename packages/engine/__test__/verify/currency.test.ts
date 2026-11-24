import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern } from "@okfit/core";
import { Bundle, ConceptId, Derive, OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { runSync } from "../../src/sync/run.js";
import { runVerify, runVerifyBatch } from "../../src/verify/run.js";
import { ROOT, seedPlatform } from "../utils/bundle.js";
import { identityConfigGet } from "../utils/gitIdentity.js";

/**
 * The edit, verify, commit sequence (phase 3, Tasks 1 and 7): sync stamps `min(commit instant, binding.at)` when the
 * binding covers the current content, so the verification stays current (R30). The
 * edited body is on disk, the old body is what `HEAD` holds until the simulated commit.
 */
const G0 = "2026-01-01T00:00:00Z";
const T1 = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
const T2 = DateTime.makeUnsafe("2026-09-16T12:00:42Z");
const T3 = DateTime.makeUnsafe("2026-09-16T12:05:00Z");
/** What `git log` answers in staged mode: deliberately not T2, so only `staged.at` can produce a T2 stamp. */
const LOG = DateTime.makeUnsafe("2026-09-20T00:00:00Z");
const NOW = DateTime.makeUnsafe("2026-09-17T00:00:00Z");
const FILE = `${ROOT}/decisions/d.md`;
const REL = "okf/decisions/d.md";
const REPO = "/repo";

const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	types: { Decision: { require_verified: true } },
	actors: { humans: ["human:ada" as ActorPattern] },
	extensions: {},
});
const options = { bundleRoot: ROOT, projectRoot: REPO, config, dryRun: false } as const;
const batchOptions = { ...options, at: T3, types: [] as ReadonlyArray<string> };

const decision = (digest: string, body: string): string =>
	`---\ntype: Decision\ntitle: D\nstatus: stable\ngenerated:\n  by: human:ada\n  at: ${G0}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---\n\n${body}\n`;

/** What `HEAD` holds and what `git log` answers: moved by the test to simulate the commit. */
interface Repo {
	head: string;
	logAt: DateTime.Utc;
	staged: ReadonlyArray<string>;
}

const services = (repo: Repo, text: string) =>
	Layer.mergeAll(
		seedPlatform({ [`${ROOT}/index.md`]: "# Decisions\n\n* [D](decisions/d.md)\n", [FILE]: text }),
		NodeCrypto.layerDigest,
		Git.layerTest({
			repoRoot: () => Effect.succeed(REPO),
			show: () => Effect.sync(() => Option.some(repo.head)),
			stagedChanges: () => Effect.sync(() => repo.staged),
			unstagedChanges: () => Effect.succeed([]),
			add: () => Effect.void,
			configGet: identityConfigGet,
		}),
		Layer.succeed(GitHistory, {
			pathLog: (_root: string, path: string) =>
				Effect.sync(() => [
					{
						sha: "0123456789abcdef0123456789abcdef01234567",
						path,
						authoredAt: repo.logAt,
						committedAt: repo.logAt,
						authorName: "Author",
						authorEmail: "author@example.com",
					},
				]),
		} as unknown as GitHistory["Service"]),
	);

/** The edited file on disk, stamped for the OLD body; `HEAD` still holds the old text (the body is dirty). */
const arrange = Effect.gen(function* () {
	const old = decision("0000000000000000", "Old body.");
	const oldDigest = yield* Derivation.bodyDigest(old);
	const original = decision(oldDigest, "Old body.");
	const edited = decision(oldDigest, "New body.");
	const repo: Repo = { head: original, logAt: T2, staged: [] };
	return { repo, edited };
}).pipe(Effect.provide(NodeCrypto.layerDigest));

const load = Effect.gen(function* () {
	const bundle = yield* Bundle.load({ root: ROOT });
	const concept = bundle.concepts.get(ConceptId.make("decisions/d"));
	if (concept === undefined) return yield* Effect.die(new Error("decisions/d did not load"));
	return concept;
});

/** The commit: `HEAD` takes the file on disk, and the log or the hook's clock answers T2 (never the same instant in both). */
const commit = (repo: Repo, mode: "walk" | "staged") =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		repo.head = yield* fs.readFileString(FILE);
		repo.logAt = mode === "walk" ? T2 : LOG;
		repo.staged = [REL];
		yield* runSync({
			...options,
			modes: new Set(["generated"]),
			...(mode === "staged" ? { staged: { at: T2 } } : {}),
		});
	});

/** Edit, `runVerify` at T1, then the commit at T2 and `runSync` in `mode`; returns the reloaded concept. */
const editVerifyCommit = (repo: Repo, mode: "walk" | "staged") =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		// precondition: the body on disk is edited while HEAD still holds the old one (dirty)
		assert.include(repo.head, "Old body.");
		assert.notInclude(yield* fs.readFileString(FILE), "Old body.");
		yield* runVerify({ ...options, id: "decisions/d", at: T1 });
		yield* commit(repo, mode);
		return yield* load;
	});

describe("verify then sync: the clamp keeps a verification of the same content current (R30)", () => {
	for (const mode of ["walk", "staged"] as const) {
		it.effect(`${mode}: sync stamps the verification instant, so the verification stays current`, () =>
			Effect.gen(function* () {
				const { repo, edited } = yield* arrange;
				return yield* Effect.gen(function* () {
					const concept = yield* editVerifyCommit(repo, mode);
					const g = concept.frontmatter.generated?.at;
					const v = concept.frontmatter.verified?.[0]?.at;
					if (g === undefined || v === undefined) return assert.fail("generated.at and verified[0].at must be present");
					assert.strictEqual(DateTime.formatIso(v), "2026-09-16T12:00:00.000Z");
					// the commit instant is T2 (staged.at in staged mode, never the git log's LOG); the binding is T1
					assert.strictEqual(DateTime.formatIso(g), "2026-09-16T12:00:00.000Z");
					assert.isFalse(DateTime.isGreaterThan(g, v));
					assert.strictEqual(Derive.trustTier(concept.frontmatter), "human-reviewed");
					const signal = yield* Trust.signal(concept, config, NOW);
					assert.strictEqual(signal.integrity, "current");
					assert.isUndefined(signal.drift);
					const batch = yield* runVerifyBatch({ ...batchOptions, dryRun: true });
					assert.deepStrictEqual(batch.skipped, [{ id: "decisions/d", reason: "already-verified" }]);
					assert.deepStrictEqual(batch.verified, []);
				}).pipe(Effect.provide(services(repo, edited)));
			}),
		);
	}

	for (const mode of ["walk", "staged"] as const) {
		it.effect(`control (${mode}): edit, commit, then verify leaves a verification at or after generated.at`, () =>
			Effect.gen(function* () {
				const { repo, edited } = yield* arrange;
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					// edit then commit first: sync stamps the commit instant T2, with no verification yet
					yield* commit(repo, mode);
					const stamped = yield* load;
					assert.strictEqual(DateTime.formatIso(stamped.frontmatter.generated?.at ?? T1), "2026-09-16T12:00:42.000Z");
					assert.isUndefined(stamped.frontmatter.verified);
					// positive control for the batch skip: an unverified concept is selected, not skipped
					const before = yield* runVerifyBatch({ ...batchOptions, dryRun: true });
					assert.deepStrictEqual(
						before.verified.map((entry) => entry.id),
						["decisions/d"],
					);
					assert.deepStrictEqual(before.skipped, []);
					// then verify at T3 > T2
					yield* runVerify({ ...options, id: "decisions/d", at: T3 });
					const concept = yield* load;
					const g = concept.frontmatter.generated?.at;
					const v = concept.frontmatter.verified?.[0]?.at;
					if (g === undefined || v === undefined) return assert.fail("generated.at and verified[0].at must be present");
					assert.isTrue(DateTime.isGreaterThanOrEqualTo(v, g));
					assert.include(yield* fs.readFileString(FILE), "2026-09-16T12:05:00Z");
					assert.strictEqual((yield* Trust.signal(concept, config, NOW)).integrity, "current");
					const after = yield* runVerifyBatch({ ...batchOptions, dryRun: true });
					assert.deepStrictEqual(after.skipped, [{ id: "decisions/d", reason: "already-verified" }]);
					assert.deepStrictEqual(after.verified, []);
				}).pipe(Effect.provide(services(repo, edited)));
			}),
		);
	}
});
