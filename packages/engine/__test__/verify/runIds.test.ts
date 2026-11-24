import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern } from "@okfit/core";
import { Bundle, Derive, OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Exit, Layer } from "effect";
import type { VerifyStatusUnknownError } from "../../src/errors.js";
import { runVerifyIds } from "../../src/verify/run.js";
import { identityConfigGet } from "../utils/gitIdentity.js";
import { TestPlatform } from "../utils/platform.js";

describe("runVerifyIds (issue #214)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const decision = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true }, Module: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Git.layerTest({
		configGet: identityConfigGet,
	});
	const platform = Layer.mergeAll(gitFake, TestPlatform);
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
					// once as the `verified` entry, once as the `integrity.verified` binding
					assert.strictEqual(a.split("2026-09-16T12:00:00Z").length - 1, 2);
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

describe("runVerifyIds refreshStaleAfter (issue #228)", () => {
	const AT = DateTime.makeUnsafe("2026-10-09T00:00:00Z");
	const concept = (extra: string): string => `---\ntype: Decision\ntitle: A\n${extra}---\n\n# A\n`;
	const staleLine = 'stale_after: "2026-01-01T00:00:00Z"\n';
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true } },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Git.layerTest({
		configGet: identityConfigGet,
	});
	const platform = Layer.mergeAll(gitFake, TestPlatform);

	const withRoot = <A, E, R>(
		files: ReadonlyArray<readonly [string, string]>,
		body: (root: string) => Effect.Effect<A, E, R>,
	) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-refresh-")));
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

	const run = (root: string, ids: ReadonlyArray<string>, refreshStaleAfter?: boolean) =>
		runVerifyIds({
			bundleRoot: root,
			projectRoot: root,
			config,
			at: AT,
			dryRun: false,
			ids,
			...(refreshStaleAfter === undefined ? {} : { refreshStaleAfter }),
		}).pipe(Effect.provide(platform));
	const read = (root: string, file: string) => Effect.promise(() => readFile(join(root, file), "utf8"));

	it.effect("rolls stale_after to at + 90d, keeps the quotes, and clears the stale report", () =>
		withRoot([["decisions/a.md", concept(staleLine)]], (root) =>
			Effect.gen(function* () {
				yield* run(root, ["decisions/a"], true);
				const text = yield* read(root, "decisions/a.md");
				assert.ok(text.includes('stale_after: "2027-01-07T00:00:00Z"\n'), text);
				assert.ok(text.includes("by: human:ada"));
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(TestPlatform));
				assert.deepStrictEqual(Derive.staleReport(bundle, AT), []);
			}),
		),
	);

	it.effect("updates the actor's existing entry instead of appending a duplicate", () =>
		withRoot(
			[
				[
					"decisions/a.md",
					concept(
						`${staleLine}verified:\n  - by: human:ada\n    at: 2026-01-01T00:00:00Z\n  - by: human:bob\n    at: 2026-01-02T00:00:00Z\n`,
					),
				],
			],
			(root) =>
				Effect.gen(function* () {
					yield* run(root, ["decisions/a"], true);
					const text = yield* read(root, "decisions/a.md");
					assert.strictEqual(text.split("- by: human:ada").length - 1, 1, text);
					assert.ok(text.includes("by: human:ada\n    at: 2026-10-09T00:00:00Z\n"), text);
					// the binding carries the overwritten `at`, so it still joins the one entry
					assert.ok(
						text.includes(
							"x-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-10-09T00:00:00Z\n    content: ",
						),
						text,
					);
					assert.ok(text.includes("by: human:bob\n    at: 2026-01-02T00:00:00Z\n"), text);
				}),
		),
	);

	it.effect("a dry run previews the whole resulting entry and the rolled stale_after, not a bare timestamp", () =>
		withRoot(
			[["decisions/a.md", concept(`${staleLine}verified:\n  - by: human:ada\n    at: 2026-01-01T00:00:00Z\n`)]],
			(root) =>
				Effect.gen(function* () {
					const result = yield* runVerifyIds({
						bundleRoot: root,
						projectRoot: root,
						config,
						at: AT,
						dryRun: true,
						ids: ["decisions/a"],
						refreshStaleAfter: true,
					}).pipe(Effect.provide(platform));
					assert.strictEqual(
						result.verified[0]?.fragment,
						"- by: human:ada\n  at: 2026-10-09T00:00:00Z\nstale_after: 2027-01-07T00:00:00Z",
					);
				}),
		),
	);

	it.effect("adds no stale_after to a concept that has none", () =>
		withRoot([["decisions/a.md", concept("")]], (root) =>
			Effect.gen(function* () {
				yield* run(root, ["decisions/a"], true);
				const text = yield* read(root, "decisions/a.md");
				assert.ok(!text.includes("stale_after"), text);
				assert.ok(text.includes("by: human:ada"));
			}),
		),
	);

	it.effect("leaves stale_after untouched without the option", () =>
		withRoot([["decisions/a.md", concept(staleLine)]], (root) =>
			Effect.gen(function* () {
				yield* run(root, ["decisions/a"]);
				const text = yield* read(root, "decisions/a.md");
				assert.ok(text.includes(staleLine), text);
			}),
		),
	);

	it.effect("writes nothing when one id in the batch is bad", () =>
		withRoot([["decisions/a.md", concept(staleLine)]], (root) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(run(root, ["decisions/a", "decisions/missing"], true));
				assert.ok(Exit.isFailure(exit));
				assert.strictEqual(yield* read(root, "decisions/a.md"), concept(staleLine));
			}),
		),
	);
});

describe("runVerifyIds refuses a status outside the vocabulary (OKF 0.3 5.4)", () => {
	const AT = DateTime.makeUnsafe("2026-10-09T00:00:00Z");
	const doc = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const staleLine = 'stale_after: "2026-01-01T00:00:00Z"\n';
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true } },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const platform = Layer.mergeAll(Git.layerTest({ configGet: identityConfigGet }), TestPlatform);

	const withRoot = <A, E, R>(
		files: ReadonlyArray<readonly [string, string]>,
		body: (root: string) => Effect.Effect<A, E, R>,
	) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-unknown-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				for (const [name, text] of files) yield* Effect.promise(() => writeFile(join(root, name), text));
				return yield* body(root);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});

	const run = (
		root: string,
		ids: ReadonlyArray<string>,
		extra: { promote?: boolean; refreshStaleAfter?: boolean; dryRun?: boolean } = {},
	) =>
		runVerifyIds({
			bundleRoot: root,
			projectRoot: root,
			config,
			at: AT,
			dryRun: extra.dryRun ?? false,
			ids,
			...extra,
		}).pipe(Effect.provide(platform));
	const read = (root: string, file: string) => Effect.promise(() => readFile(join(root, file), "utf8"));
	const fix = (root: string, file: string, from: string, to: string) =>
		Effect.promise(async () => {
			const text = await readFile(join(root, file), "utf8");
			await writeFile(join(root, file), text.replace(from, to));
		});

	it.effect("fails the whole call with the good concept untouched; the same call passes once the status is fixed", () =>
		withRoot(
			[
				["decisions/good.md", doc("Good")],
				["decisions/archived.md", doc("Archived", "status: archived\n")],
				["decisions/numeric.md", doc("Numeric", "status: 5\n")],
			],
			(root) =>
				Effect.gen(function* () {
					const before = yield* read(root, "decisions/good.md");
					for (const [ids, raw] of [
						[["decisions/good", "decisions/archived"], "archived"],
						[["decisions/archived", "decisions/good"], "archived"],
						[["decisions/good", "decisions/numeric"], "5"],
					] as const) {
						const error = yield* Effect.flip(run(root, ids));
						assert.strictEqual(error._tag, "VerifyStatusUnknownError");
						assert.strictEqual((error as VerifyStatusUnknownError).status, raw);
						assert.strictEqual(yield* read(root, "decisions/good.md"), before);
					}
					// a dry run is refused too
					const dry = yield* Effect.flip(run(root, ["decisions/archived"], { dryRun: true }));
					assert.strictEqual(dry._tag, "VerifyStatusUnknownError");
					// control: with the status fixed, the same call verifies both
					yield* fix(root, "decisions/archived.md", "status: archived", "status: stable");
					const ok = yield* run(root, ["decisions/good", "decisions/archived"]);
					assert.deepStrictEqual(
						ok.verified.map((entry) => entry.id),
						["decisions/good", "decisions/archived"],
					);
					assert.notStrictEqual(yield* read(root, "decisions/good.md"), before);
				}),
		),
	);

	it.effect("promote does not rescue an unknown status; it still promotes a draft beside it once fixed", () =>
		withRoot(
			[
				["decisions/draft.md", doc("Draft", "status: draft\n")],
				["decisions/archived.md", doc("Archived", "status: archived\n")],
			],
			(root) =>
				Effect.gen(function* () {
					const draftBefore = yield* read(root, "decisions/draft.md");
					const archivedBefore = yield* read(root, "decisions/archived.md");
					const error = yield* Effect.flip(run(root, ["decisions/draft", "decisions/archived"], { promote: true }));
					assert.strictEqual(error._tag, "VerifyStatusUnknownError");
					assert.strictEqual(yield* read(root, "decisions/draft.md"), draftBefore);
					assert.strictEqual(yield* read(root, "decisions/archived.md"), archivedBefore);
					yield* fix(root, "decisions/archived.md", "status: archived", "status: deprecated");
					yield* run(root, ["decisions/draft", "decisions/archived"], { promote: true });
					assert.include(yield* read(root, "decisions/draft.md"), "status: stable\n");
					assert.include(yield* read(root, "decisions/archived.md"), "status: deprecated\n");
				}),
		),
	);

	it.effect("refreshStaleAfter on an unknown status is refused and rolls nothing forward; fixed, it rolls", () =>
		withRoot(
			[
				["decisions/ok.md", doc("Ok", staleLine)],
				["decisions/archived.md", doc("Archived", `status: archived\n${staleLine}`)],
			],
			(root) =>
				Effect.gen(function* () {
					const okBefore = yield* read(root, "decisions/ok.md");
					const archivedBefore = yield* read(root, "decisions/archived.md");
					const error = yield* Effect.flip(
						run(root, ["decisions/ok", "decisions/archived"], { refreshStaleAfter: true }),
					);
					assert.strictEqual(error._tag, "VerifyStatusUnknownError");
					assert.strictEqual(yield* read(root, "decisions/ok.md"), okBefore);
					assert.strictEqual(yield* read(root, "decisions/archived.md"), archivedBefore);
					yield* fix(root, "decisions/archived.md", "status: archived", "status: stable");
					yield* run(root, ["decisions/ok", "decisions/archived"], { refreshStaleAfter: true });
					assert.include(yield* read(root, "decisions/archived.md"), 'stale_after: "2027-01-07T00:00:00Z"\n');
				}),
		),
	);
});

describe("runVerifyIds refuses a verification that would not be current (OKF 0.3 5.3, R33)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true } },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const platform = Layer.mergeAll(Git.layerTest({ configGet: identityConfigGet }), TestPlatform);
	const doc = (title: string, extra: string): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;

	it.effect("two ids, one not current: the whole call fails and neither file changes; at generated.at both write", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-current-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const fine = doc("F", "");
				const late = doc("L", "generated:\n  by: process:sync\n  at: 2026-09-16T12:00:01Z\n");
				yield* Effect.promise(() => writeFile(join(root, "decisions/f.md"), fine));
				yield* Effect.promise(() => writeFile(join(root, "decisions/l.md"), late));
				const args = {
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					ids: ["decisions/f", "decisions/l"],
				};
				const error = yield* Effect.flip(runVerifyIds(args).pipe(Effect.provide(platform)));
				assert.strictEqual(error._tag, "VerifyNotCurrentError");
				assert.include(error.message, "Nothing was written"); // an id list is all or nothing, and says so
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/f.md"), "utf8")), fine);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
				// control: at equal to the later generated.at succeeds and changes both files
				const ok = yield* runVerifyIds({ ...args, at: DateTime.makeUnsafe("2026-09-16T12:00:01Z") }).pipe(
					Effect.provide(platform),
				);
				assert.strictEqual(ok.verified.length, 2);
				assert.notStrictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/f.md"), "utf8")), fine);
				assert.notStrictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("stale --verify (refreshStaleAfter) is refused the same way", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-current-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const late = doc("L", "generated:\n  by: process:sync\n  at: 2026-09-17T00:00:00Z\n");
				yield* Effect.promise(() => writeFile(join(root, "decisions/l.md"), late));
				const error = yield* Effect.flip(
					runVerifyIds({
						bundleRoot: root,
						projectRoot: root,
						config,
						at: AT,
						dryRun: false,
						ids: ["decisions/l"],
						refreshStaleAfter: true,
					}).pipe(Effect.provide(platform)),
				);
				assert.strictEqual(error._tag, "VerifyNotCurrentError");
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
