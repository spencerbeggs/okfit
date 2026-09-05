import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Diagnostic, DiagnosticCode, DiagnosticRange } from "../src/Diagnostic.js";

const decodeCode = Schema.decodeUnknownEffect(DiagnosticCode);

describe("DiagnosticRange", () => {
	it("fromOffset recomputes line and character from the file text (D-14)", () => {
		const text = "---\ntype: Note\n---\n";
		const range = DiagnosticRange.fromOffset(text, 4, 4);
		assert.strictEqual(range.offset, 4);
		assert.strictEqual(range.length, 4);
		assert.strictEqual(range.line, 1);
		assert.strictEqual(range.character, 0);
	});
});

describe("Diagnostic", () => {
	it.effect("every conformance and lint code decodes through the union", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* decodeCode("type-missing"), "type-missing");
			assert.strictEqual(yield* decodeCode("stale"), "stale");
			assert.strictEqual((yield* Effect.flip(decodeCode("not-a-code")))._tag, "SchemaError");
		}),
	);
	it("isConformance is true only for a ConformanceCode member (D-32/D-33)", () => {
		const conformance = Diagnostic.make({ file: "a.md", code: "type-missing", severity: "error", message: "x" });
		const lint = Diagnostic.make({ file: "a.md", code: "stale", severity: "info", message: "x" });
		assert.isTrue(Diagnostic.isConformance(conformance));
		assert.isFalse(Diagnostic.isConformance(lint));
		assert.isFalse(
			"range" in Diagnostic.make({ file: "", code: "config-unknown-key", severity: "warning", message: "x" }),
		);
	});
});
