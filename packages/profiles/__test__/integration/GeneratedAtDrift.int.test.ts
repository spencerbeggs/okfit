import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Effect, Layer } from "effect";
import { Derivation } from "../../src/Derivation.js";
import { GitHistory } from "../../src/GitHistory.js";
import { Provenance } from "../../src/Provenance.js";
import { git, initRepo, makeTempDir, removeDir } from "../utils/git.js";

// P-30: both live layers over the real spawner; provideMerge keeps FileSystem, Path, Crypto and the
// spawner in scope (`NodeServices.layer` bundles Crypto too, EF/unstable Crypto's Node backend).
const TestLayer = Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(NodeServices.layer));
const run = <A, E>(effect: Effect.Effect<A, E, Git | GitHistory | NodeServices.NodeServices>): Effect.Effect<A, E> =>
	effect.pipe(Effect.provide(TestLayer));
const build = <A>(effect: Effect.Effect<A, never, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(run(effect));

const CONCEPT_PATH = "okf/modules/core.md";

const BODY_ONE = "Body one.";
const BODY_TWO = "Body two, a real change.";

const stampedConcept = (body: string, at: string | undefined, bodySha256: string | undefined): string =>
	[
		"---",
		"type: Module",
		"title: Core",
		"description: The core package.",
		"generated:",
		"  by: human:okfit-test",
		...(at === undefined ? [] : [`  at: ${at}`]),
		...(bodySha256 === undefined ? [] : [`  body_sha256: ${bodySha256}`]),
		"---",
		"",
		"# Core",
		"",
		body,
		"",
	].join("\n");

const digestOf = (body: string): Promise<string> =>
	Effect.runPromise(Derivation.bodyDigest(stampedConcept(body, undefined, undefined)).pipe(Effect.provide(TestLayer)));

/**
 * Amends HEAD's author/committer date in place, with no tree change -- the minimal reproduction of
 * what a squash or rebase merge does to every commit it rewrites (issue #19): the blob, digest
 * included, is carried verbatim, only the date changes.
 */
const amendDate = (dir: string, authoredAt: string) =>
	git(dir, ["commit", "-q", "--amend", "--no-edit"], { GIT_AUTHOR_DATE: authoredAt, GIT_COMMITTER_DATE: authoredAt });

const commitAll = (dir: string, message: string, authoredAt: string) =>
	Effect.gen(function* () {
		yield* git(dir, ["add", "-A"]);
		yield* git(dir, ["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: authoredAt, GIT_COMMITTER_DATE: authoredAt });
	});

describe("Provenance.lint over a squash/rebase-rewritten history (issue #19, body-digest design)", () => {
	let dir = "";
	let file = "";

	beforeAll(async () => {
		dir = await build(makeTempDir("okfit-profiles-generated-at-drift-"));
		await build(initRepo(dir));
		file = join(dir, CONCEPT_PATH);
		await mkdir(join(dir, "okf", "modules"), { recursive: true });

		// Commit 1: the concept is stamped correctly -- generated.at equals this very commit's own
		// author date, and generated.body_sha256 is the digest of BODY_ONE, exactly what `okfit sync`
		// produces right after the body-creating commit.
		const digest = await digestOf(BODY_ONE);
		await writeFile(file, stampedConcept(BODY_ONE, "2026-01-01T00:00:00Z", digest));
		await build(commitAll(dir, "add core, stamped", "2026-01-01T00:00:00+00:00"));

		// Then history is rewritten (a squash/rebase merge): the SAME commit's author date moves to
		// 2026-04-01, while the file -- digest included -- is carried verbatim. `derived.at` (a
		// git-derived instant) now reads 2026-04-01, but tier 1 (issue #19) never looks at it: the
		// digest still matches the body, full stop.
		await build(amendDate(dir, "2026-04-01T00:00:00+00:00"));
	});
	afterAll(async () => {
		await removeDir(dir);
	});

	it.effect("stays quiet: the digest still matches, so the rewritten commit date never enters the comparison", () =>
		run(
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: dir });
				const diagnostics = yield* Provenance.lint(bundle, OkfitConfig.DEFAULTS);
				assert.deepStrictEqual(diagnostics, []);
			}),
		),
	);

	it.effect("a real body change that leaves the digest stale still reports", () =>
		run(
			Effect.gen(function* () {
				// A genuine content change lands in a NEW commit; the author simply never ran `okfit sync`,
				// so `generated.body_sha256` still names BODY_ONE's digest -- tier 1 catches this
				// immediately, regardless of what history rewriting has or hasn't happened to earlier
				// commits, and regardless of `at`.
				const staleDigest = yield* Derivation.bodyDigest(stampedConcept(BODY_ONE, undefined, undefined));
				yield* Effect.promise(() => writeFile(file, stampedConcept(BODY_TWO, "2026-01-01T00:00:00Z", staleDigest)));
				yield* commitAll(dir, "change body, forget to sync", "2026-05-01T00:00:00+00:00");

				const bundle = yield* Bundle.load({ root: dir });
				const diagnostics = yield* Provenance.lint(bundle, OkfitConfig.DEFAULTS);
				assert.strictEqual(diagnostics.length, 1);
				assert.strictEqual(diagnostics[0]?.code, "generated-at-drift");
				assert.include(diagnostics[0]?.message ?? "", "the body has changed since generated.at was last stamped");
			}),
		),
	);
});
