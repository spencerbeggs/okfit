import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { DateTime, Effect, Layer, Path } from "effect";
import { Bundle } from "../src/Bundle.js";
import { verificationBlockingRestamp } from "../src/GeneratedAtFuture.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";

const NOW = DateTime.makeUnsafe("2026-11-24T10:00:00Z");
const MESSAGE =
	"generated.at 2030-01-01T00:00:00Z is more than 5 minutes later than now (2026-11-24T10:00:00Z), so no verification can count yet (OKF 0.3 §5.3) and okfit verify refuses this concept; commit any change to its body, then run okfit sync, which re-stamps it";

const concept = (at: string, status = "", verifiedAt?: string) =>
	`---\ntype: Module\n${status}generated:\n  by: human:ada\n  at: ${at}\n${
		verifiedAt === undefined ? "" : `verified:\n  - by: human:ada\n    at: ${verifiedAt}\n`
	}---\n\n# A\n`;

const load = (source: string) => {
	const mount = "/repo/generated-at-future";
	return Effect.provide(
		Bundle.load({ root: mount }),
		Layer.mergeAll(MemoryFileSystem.layerWith({ [`${mount}/a.md`]: source }), Path.layer),
	);
};

const found = (bundle: Parameters<typeof Validate.lint>[0], config: OkfitConfig, now?: DateTime.Utc) =>
	Validate.lint(bundle, config, now === undefined ? undefined : { now }).filter(
		(d) => d.code === "generated-at-future",
	);

describe("generated-at-future", () => {
	it.effect("fires at generated.at when it is later than now", () =>
		Effect.gen(function* () {
			const source = concept("2030-01-01T00:00:00Z");
			const bundle = yield* load(source);
			const out = found(bundle, OkfitConfig.DEFAULTS, NOW);
			assert.strictEqual(out.length, 1);
			assert.strictEqual(out[0]?.severity, "warning");
			assert.strictEqual(out[0]?.message, MESSAGE);
			const range = out[0]?.range;
			assert.strictEqual(
				range === undefined ? undefined : source.slice(range.offset, range.offset + range.length),
				"2030-01-01T00:00:00Z",
			);
		}),
	);

	it.effect("is silent at exactly now and without now", () =>
		Effect.gen(function* () {
			const at = yield* load(concept("2026-11-24T10:00:00Z"));
			assert.deepStrictEqual(found(at, OkfitConfig.DEFAULTS, NOW), []);
			const future = yield* load(concept("2030-01-01T00:00:00Z"));
			assert.deepStrictEqual(found(future, OkfitConfig.DEFAULTS), []);
			assert.strictEqual(found(future, OkfitConfig.DEFAULTS, NOW).length, 1, "control: it fires with now");
		}),
	);

	it.effect("is silent within the five-minute tolerance", () =>
		Effect.gen(function* () {
			const edge = yield* load(concept("2026-11-24T10:05:00Z"));
			assert.deepStrictEqual(found(edge, OkfitConfig.DEFAULTS, NOW), []);
			const over = yield* load(concept("2026-11-24T10:05:01Z"));
			assert.strictEqual(found(over, OkfitConfig.DEFAULTS, NOW).length, 1);
		}),
	);

	it.effect('[lint] generated_at_future = "off" silences it', () =>
		Effect.gen(function* () {
			const bundle = yield* load(concept("2030-01-01T00:00:00Z"));
			const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, { lint: { generated_at_future: "off" }, extensions: {} });
			assert.deepStrictEqual(found(bundle, config, NOW), []);
		}),
	);

	it.effect("fires on a draft too", () =>
		Effect.gen(function* () {
			const bundle = yield* load(concept("2030-01-01T00:00:00Z", "status: draft\n"));
			assert.strictEqual(found(bundle, OkfitConfig.DEFAULTS, NOW).length, 1);
		}),
	);
});

describe("generated-at-future when a verification blocks the re-stamp", () => {
	it.effect("says sync will not re-stamp when a verification falls between now and generated.at", () =>
		Effect.gen(function* () {
			const bundle = yield* load(concept("2030-06-01T00:00:00Z", "", "2029-01-01T00:00:00Z"));
			const out = found(bundle, OkfitConfig.DEFAULTS, DateTime.makeUnsafe("2026-11-24T00:00:00Z"));
			assert.strictEqual(out.length, 1);
			assert.strictEqual(
				out[0]?.message,
				"generated.at 2030-06-01T00:00:00Z is more than 5 minutes later than now (2026-11-24T00:00:00Z), so no verification can count yet (OKF 0.3 §5.3) and okfit verify refuses this concept; okfit sync will not re-stamp it, because the verification dated 2029-01-01T00:00:00Z would then count without a re-verification; a human must correct generated.at or that verification",
			);
		}),
	);

	it.effect("keeps the sync advice when every verification is before now", () =>
		Effect.gen(function* () {
			const bundle = yield* load(concept("2030-01-01T00:00:00Z", "", "2026-01-01T00:00:00Z"));
			const out = found(bundle, OkfitConfig.DEFAULTS, NOW);
			assert.strictEqual(out[0]?.message, MESSAGE);
		}),
	);
});

describe("verificationBlockingRestamp", () => {
	const at = (s: string) => DateTime.makeUnsafe(s);
	const G = at("2030-06-01T00:00:00Z");
	const now = at("2026-11-24T10:00:00Z");

	it("is blocking for a verification equal to the whole-second now", () => {
		const result = verificationBlockingRestamp([at("2026-11-24T10:00:00Z")], G, now);
		assert.deepStrictEqual(result._tag, "Some");
	});

	it("is not blocking for a verification equal to generated.at", () => {
		assert.deepStrictEqual(verificationBlockingRestamp([G], G, now)._tag, "None");
	});

	it("is blocking for a whole-second verification in the same second as a sub-second now", () => {
		const subSecond = at("2026-11-24T10:00:00.700Z");
		assert.deepStrictEqual(verificationBlockingRestamp([at("2026-11-24T10:00:00Z")], G, subSecond)._tag, "Some");
	});

	it("is not blocking for a verification before the whole-second now", () => {
		assert.deepStrictEqual(verificationBlockingRestamp([at("2026-11-24T09:59:59Z")], G, now)._tag, "None");
	});

	it("returns the earliest blocking verification", () => {
		const result = verificationBlockingRestamp([at("2029-01-01T00:00:00Z"), at("2028-01-01T00:00:00Z")], G, now);
		assert.deepStrictEqual(
			result._tag === "Some" ? DateTime.formatIso(result.value) : undefined,
			"2028-01-01T00:00:00.000Z",
		);
	});
});
