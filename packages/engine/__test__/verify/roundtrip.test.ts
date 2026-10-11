import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern, ConceptId } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option } from "effect";
import { runSync } from "../../src/sync/run.js";
import { runRevoke, runVerify } from "../../src/verify/run.js";
import { countLines } from "../utils/frontmatter.js";

/**
 * The cross-task round trip (final review item 4): one legacy concept through every
 * writer of the integrity family, asserting after each step that the file still parses,
 * carries exactly one `integrity:` key, and reads the signal the step should leave.
 */
describe("integrity round trip: sync, verify, re-stamp, re-verify, revoke", () => {
	const COMMITTED = "2026-06-01T08:00:00Z";
	const FIRST = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const SECOND = DateTime.makeUnsafe("2026-09-17T12:00:00Z");
	const NOW = DateTime.makeUnsafe("2026-09-18T00:00:00Z");
	const BODY = "\n# T\n\nBody.\n";
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});

	/** Git answers HEAD with the on-disk file (the body is committed) and the actor's identity. */
	const services = (root: string) =>
		Layer.mergeAll(
			Layer.succeed(Git, {
				repoRoot: () => Effect.succeed(root),
				show: (_cwd: string, _ref: string, path: string) =>
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						return Option.some(yield* fs.readFileString(join(root, path)));
					}).pipe(Effect.provide(NodeServices.layer)),
				configGet: (_cwd: string, key: string) =>
					Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
			} as unknown as Git["Service"]),
			Layer.succeed(GitHistory, {
				pathLog: (_root: string, path: string) =>
					Effect.succeed([
						{
							sha: "0123456789abcdef0123456789abcdef01234567",
							path,
							authoredAt: DateTime.makeUnsafe(COMMITTED),
							committedAt: DateTime.makeUnsafe(COMMITTED),
							authorName: "Author",
							authorEmail: "author@example.com",
						},
					]),
			} as unknown as GitHistory["Service"]),
			NodeServices.layer,
		);

	it.effect("ends with a sync that changes no byte", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-roundtrip-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const file = join(root, "decisions", "a.md");
				const read = () => Effect.promise(() => readFile(file, "utf8"));
				const layer = services(root);
				const sync = () =>
					runSync({ bundleRoot: root, config, modes: new Set(["generated"]), dryRun: false }).pipe(
						Effect.provide(layer),
					);
				const verify = (at: DateTime.Utc) =>
					runVerify({ id: "decisions/a", bundleRoot: root, projectRoot: root, config, at, dryRun: false }).pipe(
						Effect.provide(layer),
					);
				const signal = () =>
					Effect.gen(function* () {
						const bundle = yield* Bundle.load({ root });
						const concept = bundle.concepts.get("decisions/a" as ConceptId);
						if (concept === undefined) return yield* Effect.die(new Error("decisions/a did not load"));
						return yield* Trust.signal(concept, OkfitConfig.DEFAULTS, NOW);
					}).pipe(Effect.provide(NodeServices.layer));
				const oneIntegrity = (text: string) => {
					assert.strictEqual(countLines(text, /^integrity:/u), 1);
					assert.isAtMost(countLines(text, /^ {2}verified:/u), 1);
					assert.isAtMost(countLines(text, /^ {2}generated:/u), 1);
				};

				// A legacy concept: the full sha256 of the committed body under generated.body_sha256.
				const fullDigest = yield* Derivation.digestFull(Derivation.body(`---\n---${BODY}`)).pipe(
					Effect.provide(NodeServices.layer),
				);
				const legacy = `---\ntype: Decision\ntitle: T\ngenerated:\n  by: human:ada\n  at: ${COMMITTED}\n  body_sha256: ${fullDigest}\n---${BODY}`;
				yield* Effect.promise(() => writeFile(file, legacy));

				// 1. sync migrates the legacy digest into integrity.generated.body.
				const migrated = yield* sync();
				assert.deepStrictEqual(migrated.generated.migrated, ["decisions/a"]);
				const afterMigrate = yield* read();
				assert.notInclude(afterMigrate, "body_sha256");
				oneIntegrity(afterMigrate);
				assert.strictEqual((yield* signal()).integrity, "none");

				// 2. verify binds the content: the signal reads current.
				yield* verify(FIRST);
				oneIntegrity(yield* read());
				assert.strictEqual((yield* signal()).integrity, "current");

				// 3. A stale integrity.generated.body with the body unchanged: sync re-stamps that slot only.
				const afterVerify = yield* read();
				const stale = afterVerify.replace(/( {4}body: )[^\n]+/u, "$1'0000000000000000'");
				assert.notStrictEqual(stale, afterVerify);
				yield* Effect.promise(() => writeFile(file, stale));
				const restamped = yield* sync();
				assert.deepStrictEqual(restamped.generated.written, ["decisions/a"]);
				const afterRestamp = yield* read();
				assert.strictEqual(afterRestamp, afterVerify);
				oneIntegrity(afterRestamp);
				assert.strictEqual((yield* signal()).integrity, "current");

				// 4. verify again: the binding moves to the new entry, never duplicated.
				const again = yield* verify(SECOND);
				assert.deepStrictEqual(again.priorAt, ["2026-09-16T12:00:00Z"]);
				const afterReverify = yield* read();
				oneIntegrity(afterReverify);
				assert.include(afterReverify, "    at: 2026-09-17T12:00:00Z\n");
				assert.strictEqual((yield* signal()).integrity, "current");

				// 5. revoke drops the actor's entries and the binding, keeping integrity.generated.
				const revoked = yield* runRevoke({
					id: "decisions/a",
					bundleRoot: root,
					projectRoot: root,
					config,
					dryRun: false,
				}).pipe(Effect.provide(layer));
				assert.isTrue(revoked.bindingCleared);
				const afterRevoke = yield* read();
				oneIntegrity(afterRevoke);
				assert.notInclude(afterRevoke, "human:ada\n    at:");
				assert.strictEqual((yield* signal()).integrity, "none");

				// 6. sync is now a no-op: nothing written, bytes unchanged.
				const settled = yield* sync();
				assert.deepStrictEqual(settled.generated.written, []);
				assert.deepStrictEqual(settled.generated.migrated, []);
				assert.deepStrictEqual(settled.generated.unchanged, ["decisions/a"]);
				assert.strictEqual(yield* read(), afterRevoke);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
