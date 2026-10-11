import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Actor, ActorPattern } from "../src/Actor.js";

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

describe("Actor.matches / Actor.allowed", () => {
	it("an exact entry matches itself, case-insensitively", () => {
		assert.isTrue(Actor.matches("human:spencer", "human:spencer"));
		assert.isTrue(Actor.matches("human:Ada", "human:ada"));
		assert.isFalse(Actor.matches("human:ada", "human:grace"));
	});
	it("* and ? are the only wildcards", () => {
		assert.isTrue(Actor.matches("human:spencer", "human:spen*"));
		assert.isTrue(Actor.matches("human:spen", "human:spen*"));
		assert.isTrue(Actor.matches("human:ada1", "human:ada?"));
		assert.isFalse(Actor.matches("human:ada12", "human:ada?"));
		assert.isFalse(Actor.matches("human:axb", "human:a.b"));
		assert.isTrue(Actor.matches("human:a.b", "human:a.b"));
		assert.isFalse(Actor.matches("process:spencer", "human:*"));
	});
	it("a pattern never matches across whitespace or partially", () => {
		assert.isFalse(Actor.matches("human:spencer-x", "human:spencer"));
		assert.isFalse(Actor.matches("xhuman:spencer", "human:spencer"));
	});
	it("an empty list allows everyone; a non-empty list allows only matches", () => {
		assert.isTrue(Actor.allowed("human:anyone", []));
		assert.isTrue(Actor.allowed("human:spencer", ["human:ada", "human:spen*"]));
		assert.isFalse(Actor.allowed("human:grace", ["human:ada", "human:spen*"]));
	});
	it("isPattern names globbed entries", () => {
		assert.isTrue(Actor.isPattern("human:spen*"));
		assert.isTrue(Actor.isPattern("human:ad?"));
		assert.isFalse(Actor.isPattern("human:spencer"));
	});
	it("ActorPattern decodes ids, globs and (for the lint to flag) an email-shaped id", () => {
		const decodeSync = Schema.decodeUnknownSync(ActorPattern);
		assert.strictEqual(decodeSync("human:spen*"), "human:spen*");
		assert.strictEqual(decodeSync("human:spencer@example.com"), "human:spencer@example.com");
		assert.throws(() => decodeSync("not an actor"));
	});
});
