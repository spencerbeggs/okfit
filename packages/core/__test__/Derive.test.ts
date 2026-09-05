import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Schema } from "effect";
import { Actor } from "../src/Actor.js";
import { Bundle } from "../src/Bundle.js";
import { Concept } from "../src/Concept.js";
import { Derive } from "../src/Derive.js";
import { Verification } from "../src/Verification.js";
import { platformFor } from "./utils/lintFixtures.js";

type ConceptInput = Parameters<typeof Concept.make>[0];
const actor = Schema.decodeUnknownSync(Actor);
const at = DateTime.makeUnsafe("2026-06-30T14:00:00Z");
const metric = (fields: Omit<ConceptInput, "type" | "extensions" | "raw">): Concept =>
	Concept.make({ type: "Metric", extensions: {}, raw: {}, ...fields });
const verifiedBy = (by: string): Verification => Verification.make({ by: actor(by), at });
const platform = platformFor("lint/bundle", "/repo/bundle");
const loadBundle = Effect.provide(Bundle.load({ root: "/repo/bundle" }), platform);

describe("Derive", () => {
	it.effect("trustTier follows OKF 5.3", () =>
		Effect.sync(() => {
			assert.strictEqual(Derive.trustTier(metric({})), "unverified");
			assert.strictEqual(Derive.trustTier(metric({ verified: [] })), "unverified");
			const machine = metric({
				verified: [verifiedBy("process:nightly"), verifiedBy("reference_agent/gemini-2.5-pro")],
			});
			assert.strictEqual(Derive.trustTier(machine), "machine-confirmed");
			const human = metric({ verified: [verifiedBy("process:nightly"), verifiedBy("human:jsmith@acme")] });
			assert.strictEqual(Derive.trustTier(human), "human-reviewed");
		}),
	);

	it.effect("status defaults to stable", () =>
		Effect.sync(() => {
			assert.strictEqual(Derive.status(metric({})), "stable");
			assert.strictEqual(Derive.status(metric({ status: "deprecated" })), "deprecated");
		}),
	);

	it.effect("staleness and isStale compare now against stale_after inclusively", () =>
		Effect.sync(() => {
			const staleAfter = DateTime.makeUnsafe("2026-12-31T00:00:00Z");
			const concept = metric({ stale_after: staleAfter });
			assert.strictEqual(Derive.staleness(metric({}), staleAfter), "unknown");
			assert.strictEqual(Derive.staleness(concept, DateTime.makeUnsafe("2026-12-30T23:59:59Z")), "fresh");
			assert.strictEqual(Derive.staleness(concept, staleAfter), "stale");
			assert.isFalse(Derive.isStale(metric({}), staleAfter));
			assert.isTrue(Derive.isStale(concept, DateTime.makeUnsafe("2027-01-01T00:00:00Z")));
		}),
	);

	it.effect("title falls back to the file name", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			const misc = [...bundle.concepts.values()].find((c) => c.path === "notes/misc.md");
			assert.strictEqual(misc === undefined ? undefined : Derive.title(misc), "misc");
		}),
	);

	it.effect("renderIndex groups by type, sorts, folds descriptions, adds subdirectories and okf_version", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			const all = [...bundle.concepts.values()];
			assert.strictEqual(
				Derive.renderIndex("", all),
				[
					"# Decision\n",
					"* [Use pnpm](decisions/adr-1.md) - Package manager choice.\n",
					"# Module\n",
					"* [Core](modules/core.md) - The core package.",
					"* [Web](modules/web.md) - The website, served from packages/web.\n",
					"# Note\n",
					"* [misc](notes/misc.md)\n",
				].join("\n"),
			);
			const modules = all.filter((c) => c.path.startsWith("modules/"));
			assert.strictEqual(
				Derive.renderIndex("modules", modules, { okfVersion: "0.2", subdirectories: ["z", "a"] }),
				'---\nokf_version: "0.2"\n---\n\n# Module\n\n* [Core](core.md) - The core package.\n* [Web](web.md) - The website, served from packages/web.\n\n# Subdirectories\n\n* [a](a/index.md)\n* [z](z/index.md)\n',
			);
			assert.strictEqual(Derive.renderIndex("modules", []), "");
		}),
	);

	it.effect("renderLogEntry renders a date heading and starred items", () =>
		Effect.sync(() => {
			const text = Derive.renderLogEntry({ date: "2026-09-04", items: ["**Update**: one.", "**Verified** two."] });
			assert.strictEqual(text, "## 2026-09-04\n* **Update**: one.\n* **Verified** two.\n");
			assert.strictEqual(Derive.renderLogEntry({ date: "2026-09-04", items: [] }), "## 2026-09-04\n");
		}),
	);

	it.effect("synthesizeIndex lists concepts directly in dir plus immediate child directories, no frontmatter", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle;
			assert.strictEqual(
				Derive.synthesizeIndex(bundle, ""),
				"# Subdirectories\n\n* [decisions](decisions/index.md)\n* [modules](modules/index.md)\n* [notes](notes/index.md)\n",
			);
			assert.strictEqual(Derive.synthesizeIndex(bundle, "notes"), "# Note\n\n* [misc](misc.md)\n");
		}),
	);
});
