import { assert, describe, it } from "@effect/vitest";
import { ENGINE_VERSION, JsonErrorEnvelope } from "@okfit/engine";
import { Schema } from "effect";
import { isGraphPath, usageEnvelope, wantsJson } from "../../src/internal/usageEnvelope.js";

describe("wantsJson", () => {
	it("is true for a --format json pair", () => {
		assert.isTrue(wantsJson(["validate", "--format", "json"]));
	});
	it("is true for a --format=json token", () => {
		assert.isTrue(wantsJson(["validate", "--format=json"]));
	});
	it("is false for another format", () => {
		assert.isFalse(wantsJson(["validate", "--format", "human"]));
	});
	it("is false when the pair sits after --", () => {
		assert.isFalse(wantsJson(["validate", "--", "--format", "json"]));
	});
	it("is false for a trailing --format with no value", () => {
		assert.isFalse(wantsJson(["validate", "--format"]));
	});
});

describe("isGraphPath", () => {
	it("is true only for the exact okfit graph path", () => {
		assert.isTrue(isGraphPath(["okfit", "graph"]));
		assert.isFalse(isGraphPath(["okfit", "validate"]));
		assert.isFalse(isGraphPath(["okfit"]));
		assert.isFalse(isGraphPath(["okfit", "graph", "extra"]));
	});
});

describe("usageEnvelope", () => {
	it("joins the messages, tags the first error, and exits 64", () => {
		const envelope = usageEnvelope(
			[
				{ _tag: "InvalidValue", message: "m1" },
				{ _tag: "UnrecognizedOption", message: "m2" },
			],
			"1.2.3",
		);
		assert.deepStrictEqual(envelope, {
			schema: 1,
			okfit_version: "1.2.3",
			engine_version: ENGINE_VERSION,
			distribution: null,
			exit_code: 64,
			error: { tag: "InvalidValue", message: "m1; m2" },
		});
		assert.deepStrictEqual(Schema.decodeUnknownSync(JsonErrorEnvelope)(envelope), envelope);
	});
});
