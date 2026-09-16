import { assert, describe, it } from "@effect/vitest";
import type { ConceptId, StaleConcept } from "@okfit/core";
import { DateTime, Effect, Schema } from "effect";
import { StaleEnvelope, staleEnvelope } from "../../src/render/stale.js";
import { ENGINE_VERSION } from "../../src/version.js";

const staleConcept = (id: string, staleAfter: string, daysPast: number): StaleConcept => ({
	id: id as ConceptId,
	staleAfter: DateTime.makeUnsafe(staleAfter),
	daysPast,
});

describe("staleEnvelope", () => {
	it.effect("builds a fully specified envelope, deepStrictEqual, snake_case, ISO-formatted dates", () =>
		Effect.sync(() => {
			const now = DateTime.makeUnsafe("2026-09-13T00:00:00Z");
			const built = staleEnvelope({
				okfitVersion: "1.2.3",
				producer: "okfit",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				now,
				concepts: 10,
				items: [staleConcept("decisions/old", "2026-08-01T00:00:00Z", 43)],
			});
			assert.deepStrictEqual(built, {
				schema: 1,
				okfit_version: "1.2.3",
				engine_version: ENGINE_VERSION,
				producer: "okfit",
				distribution: null,
				okf_version: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				as_of: "2026-09-13T00:00:00.000Z",
				summary: { concepts: 10, stale: 1 },
				items: [{ id: "decisions/old", stale_after: "2026-08-01T00:00:00.000Z", days_past: 43 }],
			});
		}),
	);

	it.effect("summary.stale is 0 and items is [] for an empty report", () =>
		Effect.sync(() => {
			const now = DateTime.makeUnsafe("2026-09-13T00:00:00Z");
			const built = staleEnvelope({
				okfitVersion: "1.2.3",
				producer: "okfit",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: null,
				now,
				concepts: 4,
				items: [],
			});
			assert.strictEqual(built.summary.stale, 0);
			assert.deepStrictEqual(built.items, []);
			assert.isNull(built.profile);
		}),
	);

	it.effect("Schema.encodeSync(StaleEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const now = DateTime.makeUnsafe("2026-09-13T00:00:00Z");
			const built = staleEnvelope({
				okfitVersion: "1.2.3",
				producer: "okfit",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: "software-project",
				now,
				concepts: 2,
				items: [staleConcept("a", "2026-08-01T00:00:00Z", 1)],
			});
			const encoded = Schema.encodeSync(StaleEnvelope)(built);
			const decoded = Schema.decodeUnknownSync(StaleEnvelope)(encoded);
			assert.deepStrictEqual(decoded, built);
		}),
	);

	it.effect("carries engine_version === ENGINE_VERSION and echoes a given distribution", () =>
		Effect.sync(() => {
			const now = DateTime.makeUnsafe("2026-09-13T00:00:00Z");
			const built = staleEnvelope({
				okfitVersion: "1.2.3",
				producer: "okfit",
				okfVersion: "0.2",
				root: "/repo/okf",
				profile: null,
				now,
				concepts: 0,
				items: [],
				distribution: { name: "@okfit/plugin", version: "0.3.7" },
			});
			assert.strictEqual(built.engine_version, ENGINE_VERSION);
			assert.deepStrictEqual(built.distribution, { name: "@okfit/plugin", version: "0.3.7" });
		}),
	);
});
