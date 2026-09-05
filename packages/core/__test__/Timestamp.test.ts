import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { Timestamp } from "../src/Timestamp.js";

const decode = Schema.decodeUnknownEffect(Timestamp);

describe("Timestamp", () => {
	it.effect("decodes Z and numeric-offset forms to the same UTC instant and encodes back with Z", () =>
		Effect.gen(function* () {
			const z = yield* decode("2026-06-30T14:00:00Z");
			const plus = yield* decode("2026-06-30T16:00:00+02:00");
			const quoted = yield* decode("2026-06-30T14:00:00+00:00");
			assert.isTrue(DateTime.isUtc(z));
			assert.strictEqual(DateTime.formatIso(z), "2026-06-30T14:00:00.000Z");
			assert.strictEqual(DateTime.toEpochMillis(plus), DateTime.toEpochMillis(z));
			assert.strictEqual(DateTime.toEpochMillis(quoted), DateTime.toEpochMillis(z));
			const encoded = yield* Schema.encodeUnknownEffect(Timestamp)(DateTime.makeUnsafe("2026-06-30T14:00:00Z"));
			assert.strictEqual(encoded, "2026-06-30T14:00:00.000Z");
		}),
	);
	it.effect("rejects offset-less, date-only, empty, null, non-string and impossible input (D-16)", () =>
		Effect.gen(function* () {
			for (const input of ["2026-06-30T14:00:00", "2026-06-30", "", null, 1720000000, "2026-13-45T99:00:00Z"]) {
				assert.strictEqual((yield* Effect.flip(decode(input)))._tag, "SchemaError");
			}
			assert.include((yield* Effect.flip(decode("2026-06-30T14:00:00"))).message, "explicit offset");
		}),
	);
});
