import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Toml } from "@effected/toml";
import { Ajv } from "ajv";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const validate = new Ajv({ strict: false, allErrors: true }).compile(
	JSON.parse(read("schemas/config/okfit-1.0.0.json")),
);
// The installed @effected/toml@0.6.0 exposes `Toml.parseResult` (a `Result`), not
// `Toml.parseSync` — a discrepancy from the brief's citation, discharged here.
const parse = (p: string) =>
	Toml.parseResult(read(p)).pipe(Result.getOrThrowWith((e) => new Error(`TOML parse failed: ${e.message}`)));

describe("published okfit config schema against its SchemaStore fixtures", () => {
	it("accepts schemas/config/test/okfit-config.toml", () => {
		expect(validate(parse("schemas/config/test/okfit-config.toml")), JSON.stringify(validate.errors)).toBe(true);
	});
	it("rejects schemas/config/negative_test/okfit-config.toml at lint.broken_links", () => {
		expect(validate(parse("schemas/config/negative_test/okfit-config.toml"))).toBe(false);
		expect(validate.errors?.[0]?.instancePath).toBe("/lint/broken_links");
	});
	it("accepts an unknown top-level key and rejects an unknown key inside a declared table", () => {
		expect(validate({ not_a_declared_key: 1 })).toBe(true);
		expect(validate({ actors: { bogus: 1 } })).toBe(false);
	});
	it("rejects a lifecycle.default_stale_after value okfit itself would fail to load", () => {
		expect(validate({ lifecycle: { default_stale_after: "soon" } })).toBe(false);
		expect(validate.errors?.[0]?.instancePath).toBe("/lifecycle/default_stale_after");
	});
	it("accepts every duration spelling okfit's codec accepts", () => {
		for (const value of ["90d", "2w", "12h", "90 days", "1.5 hours"]) {
			expect(validate({ lifecycle: { default_stale_after: value } }), value).toBe(true);
		}
	});
});
