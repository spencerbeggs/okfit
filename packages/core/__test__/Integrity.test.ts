import { assert, describe, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import { Digest, Integrity } from "../src/Integrity.js";

describe("Integrity", () => {
	it("accepts a 16-hex digest and rejects other lengths and cases", () => {
		assert.isTrue(Result.isSuccess(Schema.decodeUnknownResult(Digest)("9a1c3f07b2e8d415")));
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Digest)("9A1C3F07B2E8D415")));
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Digest)("9a1c3f07")));
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Digest)("a".repeat(64))));
	});

	it("decodes both slots and either alone", () => {
		const both = Schema.decodeUnknownSync(Integrity)({
			generated: { body: "47fef58df84c6eb2" },
			verified: { by: "human:spencer", at: "2026-10-10T18:00:00Z", content: "9a1c3f07b2e8d415" },
		});
		assert.strictEqual(both.generated?.body, "47fef58df84c6eb2");
		assert.strictEqual(both.verified?.by, "human:spencer");
		assert.isUndefined(Schema.decodeUnknownSync(Integrity)({ generated: { body: "47fef58df84c6eb2" } }).verified);
	});
});
