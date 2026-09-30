import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { Actor } from "@okfit/core";
import { OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Layer, Option } from "effect";
import { runVerify, runVerifyBatch } from "../../src/verify/run.js";

describe("runVerifyBatch (issue #138)", () => {
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

	it.effect(
		"selects every require_verified concept lacking the actor's entry, skips drafts and repeats, writes all",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
				try {
					yield* Effect.promise(() => mkdir(join(root, "decisions")));
					yield* Effect.promise(() => writeFile(join(root, "decisions", "a.md"), decision("A")));
					yield* Effect.promise(() => writeFile(join(root, "decisions", "b.md"), decision("B", "status: draft\n")));
					yield* Effect.promise(() =>
						writeFile(
							join(root, "decisions", "c.md"),
							decision("C", "verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n"),
						),
					);
					yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
					const result = yield* runVerifyBatch({
						bundleRoot: root,
						projectRoot: root,
						config,
						at: AT,
						dryRun: false,
						types: [],
					}).pipe(Effect.provide(platform));
					assert.strictEqual(result.by, "human:ada");
					assert.deepStrictEqual(
						result.verified.map((entry) => entry.id),
						["decisions/a"],
					);
					assert.deepStrictEqual(result.skipped, [
						{ id: "decisions/b", reason: "draft" },
						{ id: "decisions/c", reason: "already-verified" },
					]);
					const a = yield* Effect.promise(() => readFile(join(root, "decisions", "a.md"), "utf8"));
					assert.ok(a.includes("verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n"));
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
	);

	it.effect("skips a deprecated concept and leaves its file byte-identical (#143)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const deprecated = decision("D", "status: deprecated\n");
				yield* Effect.promise(() => writeFile(join(root, "decisions", "d.md"), deprecated));
				const result = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					types: [],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(result.verified, []);
				assert.deepStrictEqual(result.skipped, [{ id: "decisions/d", reason: "deprecated" }]);
				const after = yield* Effect.promise(() => readFile(join(root, "decisions", "d.md"), "utf8"));
				assert.strictEqual(after, deprecated);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("--type narrows to the named types and rejects an undeclared one", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
				const result = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: ["Module"],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(
					result.verified.map((entry) => entry.id),
					["module"],
				);
				const error = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: ["Nope"],
				}).pipe(Effect.provide(platform), Effect.flip);
				assert.strictEqual(error._tag, "VerifySelectionError");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("fails the whole batch, writing nothing, when one concept's verified shape is unsupported", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				yield* Effect.promise(() => writeFile(join(root, "decisions", "a.md"), decision("A")));
				yield* Effect.promise(() =>
					writeFile(join(root, "decisions", "z.md"), decision("Z", "verified: not-a-list\n")),
				);
				const before = yield* Effect.promise(() => readFile(join(root, "decisions", "a.md"), "utf8"));
				const error = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					types: [],
				}).pipe(Effect.provide(platform), Effect.flip);
				assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions", "a.md"), "utf8")), before);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("rejects inherited Object.prototype keys as batch types", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
				const error = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: ["toString"],
				}).pipe(Effect.provide(platform), Effect.flip);
				assert.strictEqual(error._tag, "VerifySelectionError");
				if (error._tag !== "VerifySelectionError") throw new Error("unreachable: asserted above");
				assert.strictEqual(error.reason, "unknown-type");
				assert.strictEqual(error.detail, "toString");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});

describe("runVerify status (issue #185)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const VERIFIED = "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n";
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as Actor] },
		extensions: {},
	});
	const gitFake = Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
	} as unknown as Git["Service"]);
	const platform = Layer.mergeAll(gitFake, NodeServices.layer);

	/** Write `source` as decisions/a.md, run `use`, always clean up. */
	const withConcept = <A, E>(source: string, use: (root: string, file: string) => Effect.Effect<A, E>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-status-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const file = join(root, "decisions", "a.md");
				yield* Effect.promise(() => writeFile(file, source));
				return yield* use(root, file);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});

	const run = (root: string, status: "stable" | "draft" | undefined, dryRun = false) =>
		runVerify({
			id: "decisions/a",
			bundleRoot: root,
			projectRoot: root,
			config,
			at: AT,
			dryRun,
			...(status === undefined ? {} : { status }),
		}).pipe(Effect.provide(platform));

	it.effect("replaces status: draft with stable and adds the verified block", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: draft\n---\n\nbody\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after.split("status: stable").length - 1, 1);
				assert.isFalse(after.includes("status: draft"));
				assert.isTrue(after.includes(VERIFIED));
				assert.deepStrictEqual(result.status, { from: "draft", to: "stable" });
				assert.strictEqual(result.statusFragment, "stable");
			}),
		),
	);

	it.effect("verifying a single deprecated concept by id stays allowed and leaves status untouched", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: deprecated\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, undefined);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after, `---\ntype: Decision\ntitle: T\nstatus: deprecated\n${VERIFIED}---\n`);
				assert.isNull(result.statusFragment);
			}),
		),
	);

	it.effect("collision: status and verified both land at the end of the frontmatter", () =>
		withConcept("---\ntype: Decision\ntitle: T\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after, `---\ntype: Decision\ntitle: T\nstatus: stable\n${VERIFIED}---\n`);
				assert.deepStrictEqual(result.status, { from: null, to: "stable" });
			}),
		),
	);

	it.effect("no-op: a quoted status already at the target is untouched", () => {
		const before = '---\ntype: Decision\ntitle: T\nstatus: "stable"\n---\n';
		return withConcept(before, (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after, before.replace("\n---\n", `\n${VERIFIED}---\n`));
				assert.strictEqual(result.statusFragment, null);
				assert.deepStrictEqual(result.status, { from: "stable", to: "stable" });
			}),
		);
	});

	it.effect("demote: --draft rewrites status: stable", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: stable\n---\n", (root, file) =>
			Effect.gen(function* () {
				yield* run(root, "draft");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.isTrue(after.includes("status: draft\n"));
				assert.isFalse(after.includes("status: stable"));
			}),
		),
	);

	it.effect("unsupported status shape fails closed, real and dry run, file byte-identical", () => {
		const before = "---\ntype: Decision\ntitle: T\nstatus: |\n  stable\n---\n";
		return withConcept(before, (root, file) =>
			Effect.gen(function* () {
				for (const dryRun of [false, true]) {
					const error = yield* run(root, "stable", dryRun).pipe(Effect.flip);
					assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
					if (error._tag === "VerifyUnsupportedFrontmatterError") assert.strictEqual(error.key, "status");
					assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), before);
				}
			}),
		);
	});

	it.effect("CRLF + BOM: the inserted status line ends CRLF and no bare LF appears", () =>
		withConcept("\uFEFF---\r\ntype: Decision\r\ntitle: T\r\n---\r\n", (root, file) =>
			Effect.gen(function* () {
				yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.isTrue(after.startsWith("\uFEFF"));
				assert.isTrue(after.includes("status: stable\r\n"));
				assert.strictEqual(after.replace(/\r\n/g, "").indexOf("\n"), -1);
			}),
		),
	);

	it.effect("no flag: status is null and the status bytes are untouched", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: draft\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, undefined);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(result.status, null);
				assert.strictEqual(result.statusFragment, null);
				assert.isTrue(after.includes("status: draft\n"));
			}),
		),
	);
});
