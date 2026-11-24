import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import { Derive } from "../src/Derive.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { MOUNT } from "./utils/fixtures.js";
import { platformFor } from "./utils/lintFixtures.js";

const Platform = platformFor("lint/verified-before-change", MOUNT);
const load = Bundle.load({ root: MOUNT }).pipe(Effect.provide(Platform));

const ID =
	"Verified by human:ada at 2026-06-01T00:00:00Z, before the last change at 2026-06-02T00:00:00Z; the trust tier is now";
const message = (tier: string) => `${ID} ${tier} (OKF 0.3 §5.3); re-run okfit verify`;

describe("verified-before-change", () => {
	it.effect("fires only when the tier fell (OKF 0.3 §5.3)", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const found = Validate.lint(bundle, OkfitConfig.DEFAULTS)
				.filter((d) => d.code === "verified-before-change")
				.map((d) => [d.file, d.range?.line, d.message]);
			assert.deepStrictEqual(found, [
				["dropped.md", 6, message("unverified")],
				["to-machine.md", 6, message("machine-confirmed")],
			]);
			// controls: current, history behind a current human event, draft, never verified, a dropped entry
			for (const file of ["current.md", "rechecked.md", "draft.md", "none.md", "garbled.md"]) {
				assert.isFalse(
					found.some(([f]) => f === file),
					file,
				);
			}
		}),
	);

	it.effect("is a warning by default", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const found = Validate.lint(bundle, OkfitConfig.DEFAULTS).filter((d) => d.code === "verified-before-change");
			assert.deepStrictEqual(
				found.map((d) => d.severity),
				["warning", "warning"],
			);
		}),
	);

	it.effect("verified_before_change = off silences only this code", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
				lint: { verified_before_change: "off", status_missing: "warn" },
				extensions: {},
			});
			const codes = Validate.lint(bundle, config).map((d) => d.code);
			assert.isFalse(codes.includes("verified-before-change"));
			assert.isTrue(codes.includes("status-missing")); // positive control, same run
		}),
	);

	it.effect("an entry dropped by tolerant decoding counts for nothing and raises nothing", () =>
		Effect.gen(function* () {
			const bundle = yield* load;
			const concept = (path: string) => [...bundle.concepts.values()].find((c) => c.path === path)?.frontmatter;
			const garbled = concept("garbled.md");
			const current = concept("current.md");
			if (garbled === undefined || current === undefined) return assert.fail("fixtures must load");
			assert.strictEqual(Derive.trustTier(garbled), "unverified");
			assert.strictEqual(Derive.trustTier(current), "human-reviewed"); // control: a valid entry
			assert.isFalse(
				Validate.lint(bundle, OkfitConfig.DEFAULTS).some(
					(d) => d.code === "verified-before-change" && d.file === "garbled.md",
				),
			);
		}),
	);
});
