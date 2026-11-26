import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { GitHistory } from "@okfit/profiles";
import type { FileSystem } from "effect";
import { DateTime, Effect, Layer } from "effect";
import { MoveError } from "../src/errors.js";
import { planMigrationFixes } from "../src/migrate/fix.js";
import { planMove } from "../src/move/run.js";
import { runVerifyBatch } from "../src/verify/run.js";
import { UNDECLARED_PROJECT, V03_PROJECT } from "./fixtures/bundles.js";
import { ROOT, mountProject } from "./utils/bundle.js";
import { identityConfigGet } from "./utils/gitIdentity.js";
import { swapOn } from "./utils/swapPlatform.js";

/**
 * A file that changes under `Bundle.load` (an editor's atomic save) is left out of the bundle. Every writer that
 * derives from the whole bundle must then refuse or skip, never write something silently incomplete (#460).
 */
const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	actors: { humans: ["human:ada" as ActorPattern] },
	extensions: {},
});
const dropped = `${ROOT}/metrics/revenue.md`;
const resave = (fs: FileSystem.FileSystem) =>
	Effect.gen(function* () {
		const text = yield* fs.readFileString(dropped);
		yield* fs.remove(dropped);
		yield* fs.writeFileString(dropped, text);
	});
/** Swap the file after the confined read has it open: the path then names another file than the one held. */
const swapping = (seed: ReturnType<typeof mountProject>) => {
	const [layer, trap] = swapOn(seed, "open", dropped, resave, "after");
	return [
		Layer.mergeAll(
			layer,
			NodeCrypto.layerDigest,
			Git.layerTest({
				repoRoot: () => Effect.succeed("/repo"),
				configGet: identityConfigGet,
			}),
			Layer.succeed(GitHistory, {} as unknown as GitHistory["Service"]),
		),
		trap,
	] as const;
};

describe("a file that changed during the load", () => {
	it.effect("mv refuses and plans nothing: the changed file's links to the moved file would be left behind", () => {
		const [layer, trap] = swapping(mountProject(V03_PROJECT));
		trap.arm();
		return Effect.gen(function* () {
			const error = yield* Effect.flip(
				planMove({
					from: "metrics/margin",
					to: "metrics/margin-new",
					cwd: ROOT,
					bundleRoot: ROOT,
					config,
					now: AT,
				}),
			);
			assert.isTrue(trap.fired(), "the swap must have run during the load");
			assert.instanceOf(error, MoveError);
			assert.strictEqual((error as MoveError).reason, "changed-during-read");
			assert.include((error as MoveError).message, "metrics/revenue.md");
			assert.include((error as MoveError).message, "run okfit mv again");
		}).pipe(Effect.provide(layer));
	});

	it.effect("mv control: with nothing swapped, the same move is planned", () => {
		const [layer, trap] = swapping(mountProject(V03_PROJECT));
		return Effect.gen(function* () {
			const plan = yield* planMove({
				from: "metrics/margin",
				to: "metrics/margin-new",
				cwd: ROOT,
				bundleRoot: ROOT,
				config,
				now: AT,
			});
			assert.isFalse(trap.fired());
			assert.strictEqual(plan.to, "metrics/margin-new.md");
		}).pipe(Effect.provide(layer));
	});

	it.effect("migrate --fix plans no edit and refuses each selected finding", () => {
		const [layer, trap] = swapping(mountProject(UNDECLARED_PROJECT));
		const plan = (arm: boolean) =>
			Effect.gen(function* () {
				if (arm) trap.arm();
				const bundle = yield* Bundle.load({ root: ROOT });
				return yield* planMigrationFixes({ bundle, config, target: "0.3", now: AT });
			});
		return Effect.gen(function* () {
			const held = yield* plan(true);
			assert.isTrue(trap.fired(), "the swap must have run during the load");
			assert.deepStrictEqual(held.edits, []);
			assert.isAbove(held.refused.length, 0);
			assert.isTrue(held.refused.every((entry) => entry.reason.includes("changed while the bundle was being read")));
		}).pipe(Effect.provide(layer));
	});

	it.effect("migrate --fix control: with nothing swapped, the version fix is planned", () => {
		const [layer, trap] = swapping(mountProject(UNDECLARED_PROJECT));
		return Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const plan = yield* planMigrationFixes({ bundle, config, target: "0.3", now: AT });
			assert.isFalse(trap.fired());
			assert.isAbove(plan.edits.length, 0);
		}).pipe(Effect.provide(layer));
	});

	it.effect("verify's batch names the dropped concept as skipped, so a batch is never silently incomplete", () => {
		const [layer, trap] = swapping(mountProject(V03_PROJECT));
		trap.arm();
		return Effect.gen(function* () {
			const batch = yield* runVerifyBatch({
				bundleRoot: ROOT,
				projectRoot: "/repo",
				config,
				dryRun: true,
				at: AT,
				types: [],
			});
			assert.isTrue(trap.fired(), "the swap must have run during the load");
			assert.deepStrictEqual(
				batch.skipped.filter((entry) => entry.reason === "changed-during-read"),
				[{ id: "metrics/revenue", reason: "changed-during-read" }],
			);
			assert.isFalse(batch.verified.some((entry) => entry.id === "metrics/revenue"));
		}).pipe(Effect.provide(layer));
	});
});
