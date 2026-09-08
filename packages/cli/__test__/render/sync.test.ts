import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { SyncEnvelope, humanSync, syncEnvelope } from "../../src/render/sync.js";
import type { SyncResult } from "../../src/sync/run.js";

const EMPTY_MODE = { selected: true, written: [], unchanged: [], skipped: [] } as const;

const baseResult: SyncResult = {
	bundleRoot: "/repo/okf",
	dryRun: false,
	generated: { ...EMPTY_MODE, written: ["decisions/x"] },
	index: { ...EMPTY_MODE, unchanged: ["modules/index.md"] },
	log: { ...EMPTY_MODE, written: ["log.md"] },
};

describe("syncEnvelope", () => {
	it.effect("builds a schema-1 envelope with one block per mode, deepStrictEqual", () =>
		Effect.sync(() => {
			const built = syncEnvelope({
				okfitVersion: "0.1.0",
				root: "okf",
				dryRun: false,
				result: baseResult,
			});
			assert.deepStrictEqual(built, {
				schema: 1,
				okfit_version: "0.1.0",
				root: "okf",
				dry_run: false,
				exit_code: 0,
				generated: { selected: true, written: ["decisions/x"], unchanged: [], skipped: [] },
				index: { selected: true, written: [], unchanged: ["modules/index.md"], skipped: [] },
				log: { selected: true, written: ["log.md"], unchanged: [], skipped: [] },
			});
		}),
	);

	it("marks an unselected mode selected: false with three empty lists", () => {
		const unselected: SyncResult = {
			bundleRoot: "/repo/okf",
			dryRun: false,
			generated: { selected: false, written: [], unchanged: [], skipped: [] },
			index: { ...EMPTY_MODE, unchanged: ["modules/index.md"] },
			log: { selected: false, written: [], unchanged: [], skipped: [] },
		};
		const built = syncEnvelope({ okfitVersion: "0.1.0", root: "okf", dryRun: false, result: unselected });
		assert.deepStrictEqual(built.generated, { selected: false, written: [], unchanged: [], skipped: [] });
		assert.deepStrictEqual(built.log, { selected: false, written: [], unchanged: [], skipped: [] });
		assert.strictEqual(built.index.selected, true);
	});

	it("dry_run true and exit_code always 0, even with skips present", () => {
		const withSkip: SyncResult = {
			bundleRoot: "/repo/okf",
			dryRun: true,
			generated: { selected: true, written: [], unchanged: [], skipped: [{ id: "decisions/y", reason: "dirty" }] },
			index: EMPTY_MODE,
			log: EMPTY_MODE,
		};
		const built = syncEnvelope({ okfitVersion: "0.1.0", root: "okf", dryRun: true, result: withSkip });
		assert.strictEqual(built.dry_run, true);
		assert.strictEqual(built.exit_code, 0);
		assert.deepStrictEqual(built.generated.skipped, [{ id: "decisions/y", reason: "dirty" }]);
	});

	it("Schema.encodeSync(SyncEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const built = syncEnvelope({ okfitVersion: "0.1.0", root: "okf", dryRun: false, result: baseResult });
			const encoded = Schema.encodeSync(SyncEnvelope)(built);
			const decoded = Schema.decodeUnknownSync(SyncEnvelope)(encoded);
			assert.deepStrictEqual(decoded, built);
		}));

	it("rejects an unknown skipped[].reason value (contract §9.1: reason is the closed SkipReason)", () => {
		const built = syncEnvelope({
			okfitVersion: "0.1.0",
			root: "okf",
			dryRun: false,
			result: {
				bundleRoot: "/repo/okf",
				dryRun: false,
				generated: { selected: true, written: [], unchanged: [], skipped: [{ id: "a", reason: "dirty" }] },
				index: EMPTY_MODE,
				log: EMPTY_MODE,
			},
		});
		const encoded = Schema.encodeSync(SyncEnvelope)(built);
		const tampered = {
			...encoded,
			generated: { ...encoded.generated, skipped: [{ id: "a", reason: "not-a-reason" }] },
		};
		assert.throws(() => Schema.decodeUnknownSync(SyncEnvelope)(tampered));
	});
});

describe("humanSync", () => {
	it("renders one reason sentence per SkipReason member (contract §9.2's table)", () => {
		const result: SyncResult = {
			bundleRoot: "/repo/okf",
			dryRun: false,
			generated: {
				selected: true,
				written: [],
				unchanged: [],
				skipped: [
					{ id: "a", reason: "untracked" },
					{ id: "b", reason: "dirty" },
					{ id: "c", reason: "unborn" },
					{ id: "d", reason: "generated-missing" },
					{ id: "e", reason: "generated-unsupported" },
				],
			},
			index: EMPTY_MODE,
			log: { ...EMPTY_MODE, skipped: [{ id: "log.md", reason: "log-unparseable" }] },
		};
		const lines = humanSync(result).join("\n");
		assert.isTrue(lines.includes("not tracked by git"));
		assert.isTrue(lines.includes("has uncommitted changes"));
		assert.isTrue(lines.includes("the repository has no commits yet"));
		assert.isTrue(lines.includes("has no generated block"));
		assert.isTrue(lines.includes("generated.at is a shape sync cannot edit; edit it by hand"));
		assert.isTrue(lines.includes("log.md could not be parsed; see okfit validate"));
	});

	it("lists written and unchanged ids per mode", () => {
		const lines = humanSync(baseResult).join("\n");
		assert.isTrue(lines.includes("decisions/x"));
		assert.isTrue(lines.includes("modules/index.md"));
		assert.isTrue(lines.includes("log.md"));
	});
});
