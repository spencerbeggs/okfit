import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";
import { runStale } from "../../src/stale/run.js";

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
const now = DateTime.makeUnsafe("2026-09-13T00:00:00Z");

const STALE = `---\ntype: Module\nstale_after: 2026-01-01T00:00:00Z\n---\n\n# Stale\n\nBody.\n`;
const FRESH = `---\ntype: Module\nstale_after: 2099-01-01T00:00:00Z\n---\n\n# Fresh\n\nBody.\n`;
const NO_STALE_AFTER = `---\ntype: Module\n---\n\n# No stale_after\n\nBody.\n`;

describe("runStale", () => {
	it.effect("lists only stale concepts, sorted by id, with days_past floored", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-engine-stale-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "zzz.md"), STALE));
				yield* Effect.promise(() => writeFile(join(root, "aaa.md"), STALE));
				yield* Effect.promise(() => writeFile(join(root, "fresh.md"), FRESH));
				yield* Effect.promise(() => writeFile(join(root, "no-stale-after.md"), NO_STALE_AFTER));

				const result = yield* runStale({ root, now });

				assert.strictEqual(result.bundle.concepts.size, 4);
				assert.deepStrictEqual(
					result.items.map((item) => item.id),
					["aaa", "zzz"],
				);
				for (const item of result.items) {
					assert.strictEqual(DateTime.formatIso(item.staleAfter), "2026-01-01T00:00:00.000Z");
					// now (2026-09-13) minus stale_after (2026-01-01): 255 whole days.
					assert.strictEqual(item.daysPast, 255);
				}
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);

	it.effect("an empty bundle yields an empty items array", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-engine-stale-empty-")));
			try {
				const result = yield* runStale({ root, now });
				assert.strictEqual(result.bundle.concepts.size, 0);
				assert.deepStrictEqual(result.items, []);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}).pipe(Effect.provide(platform)),
	);
});
