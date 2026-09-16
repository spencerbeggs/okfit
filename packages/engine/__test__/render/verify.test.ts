import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { VerifyBatchEnvelope, VerifyEnvelope, verifyBatchEnvelope, verifyEnvelope } from "../../src/render/verify.js";
import { ENGINE_VERSION } from "../../src/version.js";

describe("verifyEnvelope", () => {
	it.effect("builds a schema-1 envelope, deepStrictEqual, distribution null by default", () =>
		Effect.sync(() => {
			const built = verifyEnvelope({
				okfitVersion: "0.1.0",
				id: "decisions/x",
				path: "okf/decisions/x.md",
				by: "human:spencer",
				at: "2026-09-16T00:00:00Z",
				dryRun: false,
			});
			assert.deepStrictEqual(built, {
				schema: 1,
				okfit_version: "0.1.0",
				engine_version: ENGINE_VERSION,
				distribution: null,
				id: "decisions/x",
				path: "okf/decisions/x.md",
				verified: { by: "human:spencer", at: "2026-09-16T00:00:00Z" },
				dry_run: false,
				exit_code: 0,
			});
		}),
	);

	it.effect("echoes a given distribution unchanged", () =>
		Effect.sync(() => {
			const built = verifyEnvelope({
				okfitVersion: "0.1.0",
				id: "decisions/x",
				path: "okf/decisions/x.md",
				by: "human:spencer",
				at: "2026-09-16T00:00:00Z",
				dryRun: false,
				distribution: { name: "@okfit/plugin", version: "0.3.7" },
			});
			assert.deepStrictEqual(built.distribution, { name: "@okfit/plugin", version: "0.3.7" });
		}),
	);

	it.effect("Schema.encodeSync(VerifyEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const built = verifyEnvelope({
				okfitVersion: "0.1.0",
				id: "decisions/x",
				path: "okf/decisions/x.md",
				by: "human:spencer",
				at: "2026-09-16T00:00:00Z",
				dryRun: true,
			});
			const encoded = Schema.encodeSync(VerifyEnvelope)(built);
			const decoded = Schema.decodeUnknownSync(VerifyEnvelope)(encoded);
			assert.deepStrictEqual(decoded, built);
		}),
	);
});

describe("verifyBatchEnvelope", () => {
	it.effect("builds a schema-1 batch envelope, deepStrictEqual, distribution null by default", () =>
		Effect.sync(() => {
			const built = verifyBatchEnvelope({
				okfitVersion: "0.1.0",
				by: "human:ada",
				at: "2026-09-16T12:00:00Z",
				concepts: [{ id: "decisions/a", path: "okf/decisions/a.md" }],
				skipped: [{ id: "decisions/d", reason: "draft" }],
				dryRun: false,
			});
			assert.deepStrictEqual(built, {
				schema: 1,
				okfit_version: "0.1.0",
				engine_version: ENGINE_VERSION,
				distribution: null,
				verified_by: "human:ada",
				verified_at: "2026-09-16T12:00:00Z",
				concepts: [{ id: "decisions/a", path: "okf/decisions/a.md" }],
				skipped: [{ id: "decisions/d", reason: "draft" }],
				dry_run: false,
				exit_code: 0,
			});
		}),
	);

	it.effect("echoes a given distribution unchanged", () =>
		Effect.sync(() => {
			const built = verifyBatchEnvelope({
				okfitVersion: "0.1.0",
				by: "human:ada",
				at: "2026-09-16T12:00:00Z",
				concepts: [],
				skipped: [],
				dryRun: false,
				distribution: { name: "@okfit/plugin", version: "0.3.7" },
			});
			assert.deepStrictEqual(built.distribution, { name: "@okfit/plugin", version: "0.3.7" });
		}),
	);

	it.effect("Schema.encodeSync(VerifyBatchEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const built = verifyBatchEnvelope({
				okfitVersion: "0.1.0",
				by: "human:ada",
				at: "2026-09-16T12:00:00Z",
				concepts: [{ id: "decisions/a", path: "okf/decisions/a.md" }],
				skipped: [{ id: "decisions/d", reason: "draft" }],
				dryRun: true,
			});
			const encoded = Schema.encodeSync(VerifyBatchEnvelope)(built);
			const decoded = Schema.decodeUnknownSync(VerifyBatchEnvelope)(encoded);
			assert.deepStrictEqual(decoded, built);
		}),
	);
});
