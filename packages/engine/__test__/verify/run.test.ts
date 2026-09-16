import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { Actor } from "@okfit/core";
import { OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Layer, Option } from "effect";
import { runVerifyBatch } from "../../src/verify/run.js";

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
