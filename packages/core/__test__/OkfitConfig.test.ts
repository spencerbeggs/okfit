import { assert, describe, it } from "@effect/vitest";
import { Toml } from "@effected/toml";
import { Duration, Effect, Schema } from "effect";
import { LintLevel, OkfitConfig, StaleAfterDuration } from "../src/OkfitConfig.js";
import { specExampleToml } from "./utils/configFixtures.js";

const decodeDuration = Schema.decodeUnknownSync(StaleAfterDuration);
const encodeDuration = Schema.encodeSync(StaleAfterDuration);
const decodeConfig = Schema.decodeUnknownSync(OkfitConfig);
const encodeConfig = Schema.encodeSync(OkfitConfig);
const same = (actual: Duration.Duration, expected: Duration.Duration): void =>
	assert.isTrue(Duration.equals(actual, expected), `${Duration.toMillis(actual)} !== ${Duration.toMillis(expected)}`);

describe("StaleAfterDuration", () => {
	it("decodes the short grammar h|d|w and Effect's '<n> <unit>' grammar", () => {
		same(decodeDuration("90d"), Duration.days(90));
		same(decodeDuration("12h"), Duration.hours(12));
		same(decodeDuration("2w"), Duration.weeks(2));
		same(decodeDuration("0d"), Duration.zero);
		same(decodeDuration("90 days"), Duration.days(90));
		same(decodeDuration("1.5 hours"), Duration.minutes(90));
		same(decodeDuration("3 weeks"), Duration.weeks(3));
	});
	it("rejects every other spelling", () => {
		for (const bad of ["90", "90m", "-1d", "", "Infinity", "90 d", "1d2h", " 90d"]) {
			assert.throws(() => decodeDuration(bad), undefined, undefined, `expected ${JSON.stringify(bad)} to fail`);
		}
	});
	it("encodes to the shortest exact short form, else millis, and round-trips", () => {
		assert.strictEqual(encodeDuration(Duration.days(90)), "90d");
		assert.strictEqual(encodeDuration(Duration.days(14)), "2w");
		assert.strictEqual(encodeDuration(Duration.hours(36)), "36h");
		assert.strictEqual(encodeDuration(Duration.zero), "0d");
		assert.strictEqual(encodeDuration(Duration.minutes(90)), "5400000 millis");
		same(decodeDuration(encodeDuration(Duration.minutes(90))), Duration.minutes(90));
	});
});

describe("LintLevel", () => {
	it("admits off, info, warn, error", () => {
		const decode = Schema.decodeUnknownSync(LintLevel);
		assert.deepStrictEqual(
			["off", "info", "warn", "error"].map((value) => decode(value)),
			["off", "info", "warn", "error"],
		);
		assert.throws(() => decode("warning"));
	});
});

describe("OkfitConfig", () => {
	it.effect("decodes the spec 4.2 example verbatim and encodes it back", () =>
		Effect.gen(function* () {
			const config = decodeConfig(yield* Toml.parse(specExampleToml));
			assert.strictEqual(config.okf_version, "0.2");
			assert.deepStrictEqual(config.bundle, { path: "okf", profile: "software-project" });
			assert.deepStrictEqual(config.concepts, { required: ["title", "description"], tags: { required: [] } });
			same(config.lifecycle!.default_stale_after!, Duration.days(90));
			assert.deepStrictEqual(config.actors, {
				agent: "okfit/claude-code",
				humans: ["human:spencer"],
			} as unknown as typeof config.actors);
			assert.deepStrictEqual(config.lint, { broken_links: "warn", missing_index: "warn", unknown_type: "error" });
			assert.deepStrictEqual(config.types!.Module!.required, ["resource", "kind"]);
			assert.strictEqual(
				config.types!.Module!.fields!.kind!.values!.workspace,
				"The monorepo root: tooling, CI, release, shared config.",
			);
			assert.strictEqual(config.types!.Decision!.require_verified, true);
			assert.strictEqual(
				config.tags!.architecture!.description,
				"Concerns the shape of the system rather than one module.",
			);
			assert.deepStrictEqual({ ...config.extensions }, {});
			const encoded = encodeConfig(config) as { lifecycle: { default_stale_after: string } };
			assert.strictEqual(encoded.lifecycle.default_stale_after, "90d");
		}),
	);
	it.effect("preserves unknown top-level keys in extensions and flattens them on encode", () =>
		Effect.gen(function* () {
			const config = decodeConfig(yield* Toml.parse('okf_version = "0.2"\nspam = "x"\n\n[foo]\nbar = 1\n'));
			assert.deepStrictEqual({ ...config.extensions }, { spam: "x", foo: { bar: 1 } });
			assert.strictEqual(config.okf_version, "0.2");
			const encoded = encodeConfig(config);
			assert.deepStrictEqual(encoded, { spam: "x", foo: { bar: 1 }, okf_version: "0.2" });
			assert.isFalse("extensions" in encoded);
			assert.throws(() => decodeConfig({ actors: { agent: "not an actor" } }));
		}),
	);
	it("DEFAULTS carries the spec 4.2 and D-34 values", () => {
		const d = OkfitConfig.DEFAULTS;
		assert.strictEqual(d.okf_version, "0.2");
		assert.deepStrictEqual(d.bundle, { path: "okf", profile: "software-project" });
		assert.deepStrictEqual(d.concepts, { required: [], tags: { required: [] } });
		same(d.lifecycle!.default_stale_after!, Duration.days(90));
		assert.deepStrictEqual([d.actors, d.types, d.tags, d.extensions], [{ humans: [] }, {}, {}, {}]);
		assert.deepStrictEqual(
			[d.lint!.broken_links, d.lint!.unknown_type, d.lint!.legacy_timestamp, Object.keys(d.lint!).length],
			["warn", "error", "info", 16],
		);
	});
	it("merge: DEFAULTS < profile < file, arrays replace, tables merge, inputs untouched", () => {
		const profile: OkfitConfig = {
			concepts: { required: ["title", "description"] },
			lint: { broken_links: "error" },
			types: { Module: { description: "profile", fields: { kind: { description: "k", values: { a: "A" } } } } },
			extensions: {},
		};
		const file: OkfitConfig = {
			concepts: { required: ["title"] },
			lint: { missing_index: "off" },
			types: { Module: { fields: { kind: { description: "k", values: { b: "B" } } } } },
			extensions: { foo: 1 },
		};
		const merged = OkfitConfig.merge(OkfitConfig.merge(OkfitConfig.DEFAULTS, profile), file);
		assert.deepStrictEqual(merged.concepts, { required: ["title"], tags: { required: [] } });
		assert.deepStrictEqual(
			[merged.lint!.broken_links, merged.lint!.missing_index, merged.lint!.unknown_type],
			["error", "off", "error"],
		);
		assert.strictEqual(merged.types!.Module!.description, "profile");
		assert.deepStrictEqual(merged.types!.Module!.fields!.kind!.values, { a: "A", b: "B" });
		assert.deepStrictEqual(merged.extensions, { foo: 1 });
		assert.strictEqual(merged.bundle!.path, "okf");
		assert.deepStrictEqual(OkfitConfig.DEFAULTS.concepts, { required: [], tags: { required: [] } });
		assert.deepStrictEqual(profile.concepts, { required: ["title", "description"] });
	});
	it("merge: replaces Duration values wholesale and skips __proto__", () => {
		const override = JSON.parse('{"lifecycle":{},"__proto__":{"polluted":true},"extensions":{}}');
		override.lifecycle.default_stale_after = Duration.days(7);
		const merged = OkfitConfig.merge(OkfitConfig.DEFAULTS, override as OkfitConfig);
		same(merged.lifecycle!.default_stale_after!, Duration.days(7));
		assert.isFalse("polluted" in merged);
		assert.strictEqual(Object.getPrototypeOf(merged), Object.prototype);
	});
	it("severityFor maps levels, applies D-34 defaults, and turns unknown-type off without types", () => {
		const d = OkfitConfig.DEFAULTS;
		assert.strictEqual(OkfitConfig.severityFor(d, "broken-links"), "warning");
		assert.strictEqual(OkfitConfig.severityFor(d, "family-invalid"), "error");
		assert.strictEqual(OkfitConfig.severityFor(d, "legacy-timestamp"), "info");
		assert.strictEqual(OkfitConfig.severityFor(d, "config-unknown-key"), "warning");
		assert.strictEqual(OkfitConfig.severityFor(d, "generated-at-drift"), "info");
		assert.strictEqual(
			OkfitConfig.severityFor({ lint: { generated_at_drift: "error" }, extensions: {} }, "generated-at-drift"),
			"error",
		);
		assert.strictEqual(OkfitConfig.severityFor({ extensions: {} }, "broken-links"), "warning");
		assert.strictEqual(
			OkfitConfig.severityFor({ lint: { broken_links: "off" }, extensions: {} }, "broken-links"),
			"off",
		);
		assert.strictEqual(OkfitConfig.severityFor({ lint: { stale: "error" }, extensions: {} }, "stale"), "error");
		assert.strictEqual(OkfitConfig.severityFor(d, "unknown-type"), "off");
		assert.strictEqual(
			OkfitConfig.severityFor({ lint: { unknown_type: "warn" }, extensions: {} }, "unknown-type"),
			"off",
		);
		const typed: OkfitConfig = { types: { Module: {} }, extensions: {} };
		assert.strictEqual(OkfitConfig.severityFor(typed, "unknown-type"), "error");
		assert.strictEqual(
			OkfitConfig.severityFor({ ...typed, lint: { unknown_type: "warn" } }, "unknown-type"),
			"warning",
		);
	});
});
