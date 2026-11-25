import { assert, describe, it } from "@effect/vitest";
import { ConfigValidationError } from "@effected/config-file";
import { ErrorText } from "@effected/kit";
import { OkfitConfig } from "@okfit/core";
import { Effect, Option, Schema, SchemaIssue } from "effect";
import { describeConfigCause } from "../../src/config/issues.js";

const validationError = (input: unknown) =>
	Schema.decodeUnknownEffect(OkfitConfig)(input).pipe(
		Effect.flip,
		Effect.map((error) => new ConfigValidationError({ path: Option.none(), issue: error.issue })),
	);

describe("describeConfigCause", () => {
	it.effect("names the failing key and the bad value", () =>
		Effect.gen(function* () {
			const text = describeConfigCause(yield* validationError({ lint: { missing_index: "loud" } }));
			assert.isTrue(text.startsWith("lint.missing_index: "), text);
			assert.include(text, 'Expected "off"');
		}),
	);

	it.effect("writes a numeric path segment as [n]", () =>
		Effect.gen(function* () {
			const text = describeConfigCause(yield* validationError({ bundle: { non_concepts: ["a", 3] } }));
			assert.isTrue(text.startsWith("bundle.non_concepts[1]: Expected string"), text);
		}),
	);

	it("drops the key part for a path-less issue", () => {
		const issue = new SchemaIssue.InvalidValue({ message: "bad whole value" });
		const text = describeConfigCause(new ConfigValidationError({ path: Option.none(), issue }));
		assert.strictEqual(text, "bad whole value");
	});

	it("joins several issues with `; `", () => {
		const issue = new SchemaIssue.Composite(Schema.String.ast, [
			new SchemaIssue.Pointer(["a"], new SchemaIssue.InvalidValue({ message: "one" })),
			new SchemaIssue.Pointer(["b"], new SchemaIssue.InvalidValue({ message: "two" })),
		]);
		assert.strictEqual(
			describeConfigCause(new ConfigValidationError({ path: Option.none(), issue })),
			"a: one; b: two",
		);
	});

	it("falls back to ErrorText.describe for any other cause", () => {
		const cause = new Error("toml parse failed");
		assert.strictEqual(describeConfigCause(cause), ErrorText.describe(cause));
		assert.strictEqual(describeConfigCause(cause), "toml parse failed");
	});
});
