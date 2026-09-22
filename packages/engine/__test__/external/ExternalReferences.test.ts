import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { ExternalReferences, ReferenceCheck } from "../../src/external/ExternalReferences.js";

describe("ExternalReferences.layerNoop", () => {
	it.effect("answers unknown, never checked, for any url; the schema rejects an unknown state", () =>
		Effect.gen(function* () {
			const references = yield* ExternalReferences;
			const result = yield* references.check("https://example.com/spec");
			assert.strictEqual(result.url, "https://example.com/spec");
			assert.strictEqual(result.state, "unknown");
			assert.isTrue(Option.isNone(result.checkedAt));
			assert.throws(() =>
				ReferenceCheck.make({ url: "x", state: "maybe" as unknown as "unknown", checkedAt: Option.none() }),
			);
		}).pipe(Effect.provide(ExternalReferences.layerNoop)),
	);
});
