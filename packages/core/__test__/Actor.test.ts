import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Actor } from "../src/Actor.js";

const decode = Schema.decodeUnknownEffect(Actor);

describe("Actor", () => {
	it.effect("accepts the spec forms and an open prefix; rejects bare words, whitespace, empty ids, non-strings", () =>
		Effect.gen(function* () {
			for (const input of [
				"reference_agent/gemini-2.5-pro",
				"human:kliu@acme",
				"process:etl-nightly",
				"team:data-eng",
			]) {
				assert.strictEqual(yield* decode(input), input);
			}
			for (const input of ["jsmith", "human: spencer", "1team:x", "human:", "", 42, null]) {
				assert.strictEqual((yield* Effect.flip(decode(input)))._tag, "SchemaError");
			}
		}),
	);
	it("classifies forms", () => {
		assert.strictEqual(Actor.form("reference_agent/gemini-2.5-pro"), "producer");
		assert.strictEqual(Actor.form("human:kliu@acme"), "human");
		assert.strictEqual(Actor.form("process:etl"), "process");
		assert.strictEqual(Actor.form("team:data-eng"), "other");
		assert.isTrue(Actor.isHuman("human:kliu@acme"));
		assert.isFalse(Actor.isHuman("humanoid:x"));
	});
});
