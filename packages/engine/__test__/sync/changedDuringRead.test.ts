import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import { OkfitConfig } from "@okfit/core";
import { GitHistory } from "@okfit/profiles";
import type { FileSystem } from "effect";
import { DateTime, Effect, Layer, Option } from "effect";
import { planSync } from "../../src/sync/run.js";
import { V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, mountProject } from "../utils/bundle.js";
import { swapOn } from "../utils/swapPlatform.js";

/**
 * A concept that changes under the load (an editor's atomic save) is left out of the loaded bundle. Sync must not
 * render anything derived from that bundle, or the concept silently drops out of its index (#460).
 */
describe("planSync: a file that changed during the load", () => {
	const concept = `${ROOT}/metrics/revenue.md`;
	const seed = {
		...mountProject(V03_PROJECT),
		[`${ROOT}/metrics/index.md`]: "# Stale\n",
		[`${ROOT}/index.md`]: "# Stale root\n",
	};
	const resave = (fs: FileSystem.FileSystem) =>
		Effect.gen(function* () {
			const text = yield* fs.readFileString(concept);
			yield* fs.remove(concept);
			yield* fs.writeFileString(concept, text);
		});
	const platformOver = (layer: Layer.Layer<FileSystem.FileSystem | import("effect").Path.Path>) =>
		Layer.mergeAll(
			layer,
			NodeCrypto.layerDigest,
			Git.layerTest({
				repoRoot: () => Effect.succeed("/repo"),
				show: () => Effect.succeed(Option.none<string>()),
			}),
			Layer.succeed(GitHistory, {
				pathLog: (_root: string, path: string) =>
					Effect.succeed([
						{
							sha: "0123456789abcdef0123456789abcdef01234567",
							path,
							authoredAt: DateTime.makeUnsafe("2026-06-01T08:00:00Z"),
							committedAt: DateTime.makeUnsafe("2026-06-01T08:00:00Z"),
							authorName: "Author",
							authorEmail: "author@example.com",
						},
					]),
			} as unknown as GitHistory["Service"]),
		);
	const options = {
		bundleRoot: ROOT,
		config: OkfitConfig.DEFAULTS,
		modes: new Set(["index", "log"] as const),
		dryRun: true,
	};

	it.effect("control: with nothing swapped, a stale index and log are planned", () => {
		const [layer, trap] = swapOn(seed, "lstat", concept, resave, 3);
		return Effect.gen(function* () {
			const plan = yield* planSync(options);
			assert.isFalse(trap.fired());
			assert.deepStrictEqual(plan.result.index.skipped, []);
			assert.include(plan.result.index.written, "metrics/index.md");
			assert.include(plan.result.index.written, "index.md");
		}).pipe(Effect.provide(platformOver(layer)));
	});

	it.effect("writes no index above the changed file and no log, and says why", () => {
		const [layer, trap] = swapOn(seed, "lstat", concept, resave, 3);
		trap.arm();
		return Effect.gen(function* () {
			const plan = yield* planSync(options);
			assert.isTrue(trap.fired(), "the swap must have run during the load");
			assert.deepStrictEqual(
				[...plan.result.index.skipped].sort((a, b) => a.id.localeCompare(b.id)),
				[
					{ id: "index.md", reason: "changed-during-read" },
					{ id: "metrics/index.md", reason: "changed-during-read" },
				],
			);
			// the directories the changed file does not sit in or under are still synced
			assert.isFalse(plan.result.index.written.includes("index.md"));
			assert.isFalse(plan.result.index.written.includes("metrics/index.md"));
			assert.deepStrictEqual(plan.result.log.skipped, [{ id: "log.md", reason: "changed-during-read" }]);
			assert.deepStrictEqual(plan.result.log.written, []);
			const targets = plan.pending.map((write) => write.target);
			for (const held of [`${ROOT}/index.md`, `${ROOT}/metrics/index.md`, `${ROOT}/log.md`]) {
				assert.isFalse(targets.includes(held), `${held} must not be planned`);
			}
		}).pipe(Effect.provide(platformOver(layer)));
	});

	it.effect("names the dropped concept in generated mode, and stamps nothing for it", () => {
		const [layer, trap] = swapOn(seed, "lstat", concept, resave, 3);
		trap.arm();
		return Effect.gen(function* () {
			const plan = yield* planSync({ ...options, modes: new Set(["generated"] as const) });
			assert.isTrue(trap.fired(), "the swap must have run during the load");
			assert.deepStrictEqual(
				plan.result.generated.skipped.filter((skip) => skip.reason === "changed-during-read"),
				[{ id: "metrics/revenue", reason: "changed-during-read" }],
			);
			assert.isFalse(plan.result.generated.written.includes("metrics/revenue"));
			assert.isFalse(plan.pending.some((write) => write.target === concept));
		}).pipe(Effect.provide(platformOver(layer)));
	});
});
