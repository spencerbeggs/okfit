import { assert, describe, it } from "@effect/vitest";
import { DiagnosticRange } from "@okfit/core";
import { Effect, Schema } from "effect";
import { JsonEnvelope, json, jsonError } from "../../src/render/json.js";
import type { RenderedDiagnostic } from "../../src/render/sort.js";

const conformance: RenderedDiagnostic = {
	source: "core.conformance",
	file: "a.md",
	code: "type-missing",
	severity: "error",
	message: "missing type",
	range: DiagnosticRange.make({ offset: 0, length: 1, line: 0, character: 0 }),
};
const lintNoRange: RenderedDiagnostic = {
	source: "core.lint",
	file: "",
	code: "config-unknown-key",
	severity: "warning",
	message: "unknown key",
};

describe("json", () => {
	it.effect("builds a fully specified envelope, deepStrictEqual, diagnostics in K-17 sort order", () =>
		Effect.sync(() => {
			const built = json({
				okfitVersion: "0.1.0",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				exitCode: 2,
				concepts: 4,
				diagnostics: [conformance, lintNoRange],
			});
			assert.deepStrictEqual(built, {
				schema: 1,
				okfit_version: "0.1.0",
				okf_version: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				exit_code: 2,
				summary: {
					conformance_errors: 1,
					lint_errors: 0,
					lint_warnings: 1,
					lint_info: 0,
					profile_errors: 0,
					concepts: 4,
				},
				// K-17: file "" leads, so lintNoRange (file "") sorts before conformance (file "a.md").
				diagnostics: [
					{
						source: "core.lint",
						file: "",
						code: "config-unknown-key",
						severity: "warning",
						message: "unknown key",
					},
					{
						source: "core.conformance",
						file: "a.md",
						code: "type-missing",
						severity: "error",
						message: "missing type",
						range: conformance.range!,
					},
				],
			});
		}),
	);

	it.effect("a diagnostic with no range has no range key at all in the built envelope", () =>
		Effect.sync(() => {
			const built = json({
				okfitVersion: "0.1.0",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: null,
				exitCode: 0,
				concepts: 1,
				diagnostics: [lintNoRange],
			});
			assert.isFalse(Object.hasOwn(built.diagnostics[0] ?? {}, "range"));
		}),
	);

	it.effect("a diagnostic with a range keeps it zero-based, untouched", () =>
		Effect.sync(() => {
			const built = json({
				okfitVersion: "0.1.0",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: null,
				exitCode: 2,
				concepts: 1,
				diagnostics: [conformance],
			});
			assert.strictEqual(built.diagnostics[0]?.range?.offset, 0);
			assert.strictEqual(built.diagnostics[0]?.range?.line, 0);
		}),
	);

	it.effect("Schema.encodeSync(JsonEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const built = json({
				okfitVersion: "0.1.0",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: null,
				exitCode: 1,
				concepts: 2,
				diagnostics: [lintNoRange, conformance],
			});
			const wire: unknown = JSON.parse(JSON.stringify(Schema.encodeSync(JsonEnvelope)(built)));
			assert.deepStrictEqual(Schema.decodeUnknownSync(JsonEnvelope)(wire), built);
		}),
	);
});

describe("jsonError", () => {
	it.effect("tag is the error's _tag when it has one", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(
				jsonError({ _tag: "ConfigPathNotFoundError", message: "config path not found: x" }, "0.1.0"),
				{
					schema: 1,
					okfit_version: "0.1.0",
					exit_code: 3,
					error: { tag: "ConfigPathNotFoundError", message: "config path not found: x" },
				},
			);
		}),
	);

	it.effect("tag falls back to the constructor name when there is no _tag", () =>
		Effect.sync(() => {
			const result = jsonError(new Error("boom"), "0.1.0");
			assert.strictEqual(result.error.tag, "Error");
			assert.strictEqual(result.error.message, "boom");
		}),
	);

	it.effect("falls back to String(error) for a message-less, tag-less value", () =>
		Effect.sync(() => {
			const result = jsonError("plain string failure", "0.1.0");
			assert.strictEqual(result.error.tag, "UnknownError");
			assert.strictEqual(result.error.message, "plain string failure");
		}),
	);
});
