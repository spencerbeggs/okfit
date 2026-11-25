import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern } from "@okfit/core";
import { Bundle, Derive, OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Exit, Layer } from "effect";
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
					// once as the `verified` entry, once as the `x-okfit-integrity.verified` binding
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

	it.effect("runVerifyIds with refreshStaleAfter keeps a BOM (stale --verify's path)", () =>
		withRoot([["decisions/a.md", `\uFEFF${concept(staleLine)}`]], (root) =>
			Effect.gen(function* () {
				yield* run(root, ["decisions/a"], true);
				const bytes = yield* Effect.promise(() => readFile(join(root, "decisions/a.md")));
				assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
				assert.notDeepEqual([...bytes.subarray(3, 6)], [0xef, 0xbb, 0xbf]);
				assert.ok(bytes.toString("utf8").includes('stale_after: "2027-01-07T00:00:00Z"\n'));
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

describe("runVerifyIds skips a status outside the vocabulary (OKF 0.3 5.4, #507)", () => {
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

	it.effect("runVerifyIds skips an unknown status and verifies the rest (#507)", () =>
		withRoot(
			[
				["decisions/wip.md", doc("Wip", "status: wip\n")],
				["decisions/stable.md", doc("Stable")],
				["decisions/numeric.md", doc("Numeric", "status: 5\n")],
			],
			(root) =>
				Effect.gen(function* () {
					const stableBefore = yield* read(root, "decisions/stable.md");
					const wipBefore = yield* read(root, "decisions/wip.md");
					const numericBefore = yield* read(root, "decisions/numeric.md");
					const result = yield* run(root, ["decisions/wip", "decisions/stable", "decisions/numeric"]);
					assert.deepStrictEqual(result.skipped, [
						{ id: "decisions/wip", reason: "unknown-status", status: "wip" },
						{ id: "decisions/numeric", reason: "unknown-status", status: "5" },
					]);
					assert.deepStrictEqual(
						result.verified.map((entry) => entry.id),
						["decisions/stable"],
					);
					assert.notStrictEqual(yield* read(root, "decisions/stable.md"), stableBefore);
					assert.strictEqual(yield* read(root, "decisions/wip.md"), wipBefore);
					assert.strictEqual(yield* read(root, "decisions/numeric.md"), numericBefore);
					// control: one id alone is still refused through runVerify's path, not here (the CLI routes it)
				}),
		),
	);

	it.effect("an id that is both unknown-status and not current is skipped as unknown-status", () =>
		withRoot(
			[["decisions/both.md", doc("Both", "status: wip\ngenerated:\n  by: process:sync\n  at: 2026-10-09T00:00:01Z\n")]],
			(root) =>
				Effect.gen(function* () {
					const before = yield* read(root, "decisions/both.md");
					const result = yield* run(root, ["decisions/both"]);
					assert.deepStrictEqual(result.skipped, [{ id: "decisions/both", reason: "unknown-status", status: "wip" }]);
					assert.strictEqual(yield* read(root, "decisions/both.md"), before);
				}),
		),
	);

	it.effect("every id unknown: nothing is written and the call succeeds, under promote and refreshStaleAfter too", () =>
		withRoot(
			[
				["decisions/a.md", doc("A", `status: archived\n${staleLine}`)],
				["decisions/b.md", doc("B", "status: wip\n")],
			],
			(root) =>
				Effect.gen(function* () {
					const before = [yield* read(root, "decisions/a.md"), yield* read(root, "decisions/b.md")];
					for (const extra of [{}, { promote: true }, { refreshStaleAfter: true }]) {
						const result = yield* run(root, ["decisions/b", "decisions/a"], extra);
						assert.deepStrictEqual(result.verified, []);
						assert.deepStrictEqual(
							result.skipped.map((entry) => entry.id),
							["decisions/b", "decisions/a"],
						);
					}
					assert.deepStrictEqual([yield* read(root, "decisions/a.md"), yield* read(root, "decisions/b.md")], before);
				}),
		),
	);

	it.effect("promote does not rescue an unknown status; it still promotes a draft beside it", () =>
		withRoot(
			[
				["decisions/draft.md", doc("Draft", "status: draft\n")],
				["decisions/archived.md", doc("Archived", "status: archived\n")],
			],
			(root) =>
				Effect.gen(function* () {
					const archivedBefore = yield* read(root, "decisions/archived.md");
					const result = yield* run(root, ["decisions/draft", "decisions/archived"], { promote: true });
					assert.deepStrictEqual(result.skipped, [
						{ id: "decisions/archived", reason: "unknown-status", status: "archived" },
					]);
					assert.include(yield* read(root, "decisions/draft.md"), "status: stable\n");
					assert.strictEqual(yield* read(root, "decisions/archived.md"), archivedBefore);
				}),
		),
	);

	it.effect("refreshStaleAfter skips an unknown status and rolls only the verified one", () =>
		withRoot(
			[
				["decisions/ok.md", doc("Ok", staleLine)],
				["decisions/archived.md", doc("Archived", `status: archived\n${staleLine}`)],
			],
			(root) =>
				Effect.gen(function* () {
					const archivedBefore = yield* read(root, "decisions/archived.md");
					yield* run(root, ["decisions/ok", "decisions/archived"], { refreshStaleAfter: true });
					assert.include(yield* read(root, "decisions/ok.md"), 'stale_after: "2027-01-07T00:00:00Z"\n');
					assert.strictEqual(yield* read(root, "decisions/archived.md"), archivedBefore);
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

	it.effect("runVerifyIds skips a not-current id and verifies the rest (#470)", () =>
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
				const result = yield* runVerifyIds(args).pipe(Effect.provide(platform));
				assert.deepStrictEqual(
					result.verified.map((entry) => entry.id),
					["decisions/f"],
				);
				assert.deepStrictEqual(result.skipped, [
					{
						id: "decisions/l",
						reason: "not-current",
						notCurrent: { at: "2026-09-16T12:00:00Z", generatedAt: "2026-09-16T12:00:01Z" },
					},
				]);
				assert.notStrictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/f.md"), "utf8")), fine);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
				// control: at equal to the later generated.at verifies both, so the skip was the not-current rule
				const ok = yield* runVerifyIds({ ...args, at: DateTime.makeUnsafe("2026-09-16T12:00:01Z") }).pipe(
					Effect.provide(platform),
				);
				assert.strictEqual(ok.verified.length, 2);
				assert.deepStrictEqual(ok.skipped, []);
				assert.notStrictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("an explicit id list whose every id is not current writes nothing and does not fail (#470)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-current-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const late = doc("L", "generated:\n  by: process:sync\n  at: 2026-09-16T12:00:01Z\n");
				const later = doc("M", "generated:\n  by: process:sync\n  at: 2026-09-17T00:00:00Z\n");
				yield* Effect.promise(() => writeFile(join(root, "decisions/l.md"), late));
				yield* Effect.promise(() => writeFile(join(root, "decisions/m.md"), later));
				const result = yield* runVerifyIds({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					ids: ["decisions/l", "decisions/m"],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(result.verified, []);
				assert.deepStrictEqual(result.skipped, [
					{
						id: "decisions/l",
						reason: "not-current",
						notCurrent: { at: "2026-09-16T12:00:00Z", generatedAt: "2026-09-16T12:00:01Z" },
					},
					{
						id: "decisions/m",
						reason: "not-current",
						notCurrent: { at: "2026-09-16T12:00:00Z", generatedAt: "2026-09-17T00:00:00Z" },
					},
				]);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/m.md"), "utf8")), later);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("skipped follows the order the ids were given, not sorted order", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-current-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				for (const name of ["a", "b", "c"]) {
					yield* Effect.promise(() =>
						writeFile(
							join(root, `decisions/${name}.md`),
							doc(name, "generated:\n  by: process:sync\n  at: 2026-09-17T00:00:00Z\n"),
						),
					);
				}
				const result = yield* runVerifyIds({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					ids: ["decisions/c", "decisions/a", "decisions/b"],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(
					result.skipped.map((entry) => entry.id),
					["decisions/c", "decisions/a", "decisions/b"],
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("stale --verify (refreshStaleAfter) skips a not-current id the same way", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-current-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const late = doc("L", "generated:\n  by: process:sync\n  at: 2026-09-17T00:00:00Z\n");
				yield* Effect.promise(() => writeFile(join(root, "decisions/l.md"), late));
				const result = yield* runVerifyIds({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					ids: ["decisions/l"],
					refreshStaleAfter: true,
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(result.skipped, [
					{
						id: "decisions/l",
						reason: "not-current",
						notCurrent: { at: "2026-09-16T12:00:00Z", generatedAt: "2026-09-17T00:00:00Z" },
					},
				]);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions/l.md"), "utf8")), late);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("each not-current skip carries its detail, with the kind when now is given (#504)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-ids-detail-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const stamp = (at: string) => doc("T", `generated:\n  by: process:sync\n  at: ${at}\n`);
				yield* Effect.promise(() => writeFile(join(root, "decisions/far.md"), stamp("2027-09-16T12:00:00Z")));
				yield* Effect.promise(() => writeFile(join(root, "decisions/near.md"), stamp("2026-09-16T12:02:00Z")));
				const args = {
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					now: AT,
					dryRun: true,
					ids: ["decisions/far", "decisions/near"],
				};
				const result = yield* runVerifyIds(args).pipe(Effect.provide(platform));
				assert.deepStrictEqual(result.skipped, [
					{
						id: "decisions/far",
						reason: "not-current",
						notCurrent: { at: "2026-09-16T12:00:00Z", generatedAt: "2027-09-16T12:00:00Z", kind: "future" },
					},
					{
						id: "decisions/near",
						reason: "not-current",
						notCurrent: { at: "2026-09-16T12:00:00Z", generatedAt: "2026-09-16T12:02:00Z", kind: "near-future" },
					},
				]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
