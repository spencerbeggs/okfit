import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { Generated } from "../src/Generated.js";
import { Source, UsageWindow } from "../src/Source.js";
import { Status } from "../src/Status.js";
import { Verification } from "../src/Verification.js";

const decodeStatus = Schema.decodeUnknownEffect(Status);
const decodeGenerated = Schema.decodeUnknownEffect(Generated);
const decodeList = Schema.decodeUnknownEffect(Verification.List);
const decodeSource = Schema.decodeUnknownEffect(Source);

describe("Status", () => {
	it.effect("accepts the three spec values and nothing else", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* decodeStatus("draft"), "draft");
			assert.strictEqual(yield* decodeStatus("deprecated"), "deprecated");
			for (const input of ["archived", "Stable", "", null]) {
				assert.strictEqual((yield* Effect.flip(decodeStatus(input)))._tag, "SchemaError");
			}
		}),
	);
});

describe("Generated", () => {
	it.effect("decodes by with an optional at; fails on a missing by, bad actor, or offset-less at", () =>
		Effect.gen(function* () {
			const full = yield* decodeGenerated({ by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00Z" });
			assert.strictEqual(DateTime.formatIso(full.at!), "2026-06-30T14:00:00.000Z");
			assert.isFalse("at" in (yield* decodeGenerated({ by: "human:kliu@acme" })));
			for (const input of [
				{ at: "2026-06-30T14:00:00Z" },
				{ by: "jsmith" },
				{ by: "human:x", at: "2026-06-30T14:00:00" },
			]) {
				assert.strictEqual((yield* Effect.flip(decodeGenerated(input)))._tag, "SchemaError");
			}
			assert.strictEqual(Generated.LEGACY_BY, "process:legacy-timestamp");
		}),
	);
});

describe("Verification.List", () => {
	it.effect("accepts a bare mapping or a list, always yields a list, and encodes a list (D-17)", () =>
		Effect.gen(function* () {
			const bare = yield* decodeList({ by: "human:kliu@acme", at: "2026-07-01T16:00:00Z" });
			assert.strictEqual(bare.length, 1);
			assert.instanceOf(bare[0], Verification);
			const list = yield* decodeList([
				{ by: "human:kliu@acme", at: "2026-07-01T16:00:00Z" },
				{ by: "process:ci", at: "2026-07-02T00:00:00+00:00" },
			]);
			assert.strictEqual(list.length, 2);
			assert.deepStrictEqual(yield* decodeList([]), []);
			assert.strictEqual((yield* Effect.flip(decodeList([{ by: "human:y" }])))._tag, "SchemaError");
			const encoded = yield* Schema.encodeUnknownEffect(Verification.List)(bare);
			assert.deepStrictEqual(encoded, [{ by: "human:kliu@acme", at: "2026-07-01T16:00:00.000Z" }]);
		}),
	);
});

describe("Source", () => {
	it.effect("decodes the acme orders.md source shape and requires only resource", () =>
		Effect.gen(function* () {
			const source = yield* decodeSource({
				resource: "bigquery://acme-prod/sales/orders",
				author: "team:data-platform",
				usage_count: 1240,
				last_modified: "2026-06-15T00:00:00Z",
				usage_window: { from: "2026-04-01T00:00:00Z", to: "2026-06-30T00:00:00Z" },
			});
			assert.strictEqual(source.usage_count, 1240);
			assert.instanceOf(source.usage_window, UsageWindow);
			assert.strictEqual(DateTime.formatIso(source.usage_window!.to), "2026-06-30T00:00:00.000Z");
			assert.deepStrictEqual(Object.keys(yield* decodeSource({ resource: "policies/pii.md" })), ["resource"]);
		}),
	);
	it.effect("accepts usage_count as a number or numeric string (D-19); rejects bad shapes", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* decodeSource({ resource: "x", usage_count: "1240" })).usage_count, 1240);
			for (const input of [
				{ resource: "x", usage_count: "many" },
				{ id: "no-resource" },
				{ resource: "x", author: "jsmith" },
				{ resource: "x", usage_window: { from: "2026-04-01T00:00:00", to: "2026-06-30T00:00:00Z" } },
			]) {
				assert.strictEqual((yield* Effect.flip(decodeSource(input)))._tag, "SchemaError");
			}
		}),
	);
});
