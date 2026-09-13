import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { okfitConfigDocumentFields } from "../src/OkfitConfig.js";

// Since effect@4.0.0-rc.113 (#8147) `toJsonSchemaDocument` leaves structs
// open by default; `onExcessProperty: "error"` is what closes the declared
// tables (C-16). The published document cannot pass it through
// `@effected/schemastore` yet (effected#688), so this proves the schema's own
// shape rather than what `pnpm generate-schema` currently writes.
const document = () =>
	Schema.toJsonSchemaDocument(okfitConfigDocumentFields, { onExcessProperty: "error" }).schema as Record<
		string,
		unknown
	>;
const properties = () => document()["properties"] as Record<string, Record<string, unknown>>;

describe("okfitConfigDocumentFields", () => {
	it("drops extensions and keeps the other eight top-level keys", () => {
		assert.deepStrictEqual(Object.keys(properties()).sort(), [
			"actors",
			"bundle",
			"concepts",
			"lifecycle",
			"lint",
			"okf_version",
			"tags",
			"types",
		]);
	});

	it("leaves the root open and every declared table closed", () => {
		const root = document();
		assert.strictEqual(root["additionalProperties"], undefined);
		assert.strictEqual(root["required"], undefined);
		assert.deepStrictEqual(root["allOf"], [{ type: "object", additionalProperties: {} }]);
		for (const key of ["bundle", "concepts", "lifecycle", "actors", "lint"]) {
			assert.strictEqual(properties()[key]?.["additionalProperties"], false, key);
		}
		// J-12: no annotation carries an `identifier`, so nothing is hoisted.
		assert.strictEqual(root["$defs"], undefined);
		assert.strictEqual(root["definitions"], undefined);
	});

	it("carries the root title and a description ending in the docs URL", () => {
		const root = document();
		assert.strictEqual(root["title"], "okfit config");
		assert.isTrue(String(root["description"]).endsWith("\nhttps://github.com/spencerbeggs/okfit#configuration"));
	});

	it("carries titles, descriptions, defaults and examples on the scalar fields", () => {
		const okfVersion = properties()["okf_version"];
		assert.strictEqual(okfVersion?.["title"], "OKF spec version");
		assert.strictEqual(okfVersion?.["description"], "The Open Knowledge Format spec version this bundle targets.");
		assert.strictEqual(okfVersion?.["default"], "0.2");
		assert.deepStrictEqual(okfVersion?.["examples"], ["0.2"]);
	});

	it("annotates lifecycle.default_stale_after through the encoded side", () => {
		const lifecycle = properties()["lifecycle"]?.["properties"] as Record<string, Record<string, unknown>>;
		const stale = lifecycle["default_stale_after"];
		assert.strictEqual(stale?.["title"], "Stale-after duration");
		assert.strictEqual(stale?.["default"], "90d");
		assert.deepStrictEqual(stale?.["examples"], ["90d", "2w", "12h"]);
		// I4: a `pattern` an editor can enforce, built from the same regexes
		// `parseStaleAfter` decodes with.
		assert.strictEqual(
			stale?.["pattern"],
			"^(?:\\d+[hdw]|\\d+(?:\\.\\d+)?\\s+(?:nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?))$",
		);
	});

	it("gives each of the seventeen lint keys its own rendered code as the title", () => {
		const lint = properties()["lint"]?.["properties"] as Record<string, Record<string, unknown>>;
		assert.deepStrictEqual(
			Object.entries(lint).map(([key, value]) => [key, value["title"]]),
			[
				["broken_links", "broken-links"],
				["missing_index", "missing-index"],
				["unknown_type", "unknown-type"],
				["required_key_missing", "required-key-missing"],
				["field_value_unknown", "field-value-unknown"],
				["require_verified_unmet", "require-verified-unmet"],
				["family_invalid", "family-invalid"],
				["computation_runtime_missing", "computation-runtime-missing"],
				["footnote_source_unknown", "footnote-source-unknown"],
				["footnote_undefined", "footnote-undefined"],
				["log_frontmatter", "log-frontmatter"],
				["actor_prefix_unknown", "actor-prefix-unknown"],
				["legacy_timestamp", "legacy-timestamp"],
				["config_unknown_key", "config-unknown-key"],
				["stale", "stale"],
				["walk_unreadable", "walk-unreadable"],
				["generated_at_drift", "generated-at-drift"],
			],
		);
		assert.strictEqual(
			lint["broken_links"]?.["description"],
			'A link in a concept\'s body or frontmatter does not resolve. Default "warn".',
		);
	});

	it("keeps Actor's pattern and examples wherever an actor appears", () => {
		const actors = properties()["actors"]?.["properties"] as Record<string, Record<string, unknown>>;
		const agent = actors["agent"];
		assert.strictEqual(agent?.["title"], "Agent actor");
		assert.deepStrictEqual(agent?.["examples"], ["okfit/claude-code", "human:spencer", "process:ci"]);
		assert.isTrue(String(agent?.["pattern"]).includes("A-Za-z0-9_-"));
		const humans = actors["humans"]?.["items"] as Record<string, unknown>;
		assert.strictEqual(humans["title"], "Actor");
	});

	it("is not re-exported as okfitConfigFields, which stays out of the barrel", async () => {
		const barrel = (await import("../src/index.js")) as Record<string, unknown>;
		assert.isDefined(barrel["okfitConfigDocumentFields"]);
		assert.isUndefined(barrel["okfitConfigFields"]);
	});
});
