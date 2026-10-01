import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { Actor } from "@okfit/core";
import { OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Layer, Option } from "effect";
import { runVerifyIds } from "../../src/verify/run.js";

describe("runVerifyIds (issue #214)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const decision = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true }, Module: {} },
		actors: { humans: ["human:ada" as Actor] },
		extensions: {},
	});
	const gitFake = Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
	} as unknown as Git["Service"]);
	const platform = Layer.mergeAll(gitFake, NodeServices.layer);
	const verifiedByAda = "verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n";

	const withRoot = <A, E, R>(
		files: ReadonlyArray<readonly [string, string]>,
		body: (root: string) => Effect.Effect<A, E, R>,
	) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				for (const [name, text] of files) {
					yield* Effect.promise(() => writeFile(join(root, name), text));
				}
				return yield* body(root);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});

	const options = (root: string, ids: ReadonlyArray<string>, extra: { dryRun?: boolean; promote?: boolean } = {}) => ({
		bundleRoot: root,
		projectRoot: root,
		config,
		at: AT,
		dryRun: extra.dryRun ?? false,
		ids,
		...(extra.promote === undefined ? {} : { promote: extra.promote }),
	});

	const read = (root: string, file: string) => Effect.promise(() => readFile(join(root, file), "utf8"));

	it.effect("attests drafts, deprecated and already-verified picks, normalising and de-duplicating ids", () =>
		withRoot(
			[
				["decisions/a.md", decision("A", "status: draft\n")],
				["decisions/b.md", decision("B", "status: deprecated\n")],
				["decisions/c.md", decision("C", verifiedByAda)],
			],
			(root) =>
				Effect.gen(function* () {
					const result = yield* runVerifyIds(
						options(root, ["/decisions/a.md", "decisions/b", "decisions/c", "decisions/a"]),
					).pipe(Effect.provide(platform));
					assert.strictEqual(result.by, "human:ada");
					assert.strictEqual(result.dryRun, false);
					assert.deepStrictEqual(result.skipped, []);
					assert.deepStrictEqual(
						result.verified.map((entry) => entry.id),
						["decisions/a", "decisions/b", "decisions/c"],
					);
					for (const name of ["a", "b", "c"]) {
						const text = yield* read(root, `decisions/${name}.md`);
						assert.ok(text.includes("by: human:ada\n    at: 2026-09-16T12:00:00Z\n"), name);
					}
					const a = yield* read(root, "decisions/a.md");
					assert.strictEqual(a.split("2026-09-16T12:00:00Z").length - 1, 1);
					assert.ok(a.includes("status: draft"));
				}),
		),
	);

	it.effect("fails the whole call with the tree untouched when the LAST id is unknown", () =>
		withRoot(
			[
				["decisions/a.md", decision("A")],
				["decisions/b.md", decision("B")],
			],
			(root) =>
				Effect.gen(function* () {
					const beforeA = yield* read(root, "decisions/a.md");
					const beforeB = yield* read(root, "decisions/b.md");
					const error = yield* runVerifyIds(options(root, ["decisions/a", "decisions/b", "decisions/nope"])).pipe(
						Effect.provide(platform),
						Effect.flip,
					);
					assert.strictEqual(error._tag, "VerifyConceptNotFoundError");
					assert.strictEqual(yield* read(root, "decisions/a.md"), beforeA);
					assert.strictEqual(yield* read(root, "decisions/b.md"), beforeB);
				}),
		),
	);

	it.effect("rejects reserved files and unsupported shapes without writing anything", () =>
		withRoot(
			[
				["decisions/a.md", decision("A")],
				["decisions/z.md", decision("Z", "verified: not-a-list\n")],
				["index.md", "# index\n"],
			],
			(root) =>
				Effect.gen(function* () {
					const beforeA = yield* read(root, "decisions/a.md");
					const reserved = yield* runVerifyIds(options(root, ["decisions/a", "index"])).pipe(
						Effect.provide(platform),
						Effect.flip,
					);
					assert.strictEqual(reserved._tag, "VerifyConceptNotFoundError");
					const unsupported = yield* runVerifyIds(options(root, ["decisions/a", "decisions/z"])).pipe(
						Effect.provide(platform),
						Effect.flip,
					);
					assert.strictEqual(unsupported._tag, "VerifyUnsupportedFrontmatterError");
					assert.strictEqual(yield* read(root, "decisions/a.md"), beforeA);
				}),
		),
	);

	it.effect("dryRun writes nothing and reports the same shape", () =>
		withRoot([["decisions/a.md", decision("A")]], (root) =>
			Effect.gen(function* () {
				const before = yield* read(root, "decisions/a.md");
				const result = yield* runVerifyIds(options(root, ["decisions/a"], { dryRun: true })).pipe(
					Effect.provide(platform),
				);
				assert.strictEqual(result.dryRun, true);
				assert.strictEqual(result.verified.length, 1);
				assert.ok(result.verified[0]?.fragment.includes("human:ada"));
				assert.strictEqual(yield* read(root, "decisions/a.md"), before);
			}),
		),
	);

	it.effect("promote: true sets status: stable on drafts only, in the same write", () =>
		withRoot(
			[
				["decisions/a.md", decision("A", "status: draft\n")],
				["decisions/b.md", decision("B", "status: deprecated\n")],
				["decisions/c.md", decision("C")],
			],
			(root) =>
				Effect.gen(function* () {
					yield* runVerifyIds(options(root, ["decisions/a", "decisions/b", "decisions/c"], { promote: true })).pipe(
						Effect.provide(platform),
					);
					const a = yield* read(root, "decisions/a.md");
					assert.ok(a.includes("status: stable") && !a.includes("status: draft"));
					assert.ok(a.includes("by: human:ada"));
					assert.ok((yield* read(root, "decisions/b.md")).includes("status: deprecated"));
					assert.ok(!(yield* read(root, "decisions/c.md")).includes("status:"));
				}),
		),
	);

	it.effect("promote defaults to false: a draft keeps its status", () =>
		withRoot([["decisions/a.md", decision("A", "status: draft\n")]], (root) =>
			Effect.gen(function* () {
				yield* runVerifyIds(options(root, ["decisions/a"])).pipe(Effect.provide(platform));
				assert.ok((yield* read(root, "decisions/a.md")).includes("status: draft"));
			}),
		),
	);
});
