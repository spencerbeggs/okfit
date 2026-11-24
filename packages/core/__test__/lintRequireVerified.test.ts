import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { MOUNT } from "./utils/fixtures.js";
import { platformFor } from "./utils/lintFixtures.js";

const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	types: { Decision: { require_verified: true } },
	extensions: {},
});

describe("require-verified-unmet message", () => {
	it.effect("names a fix that works for an unknown status, keeps the plain message otherwise (#459)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			const found = Validate.lint(bundle, config)
				.filter((d) => d.code === "require-verified-unmet")
				.map((d) => [d.file, d.message]);
			assert.deepStrictEqual(found, [
				["stable.md", 'Type "Decision" requires a verified entry'],
				[
					"unknown.md",
					'Type "Decision" requires a verified entry; status "archived" is not draft, stable or deprecated, so set it first or verify with okfit verify --stable or --draft',
				],
			]);
			// a draft stays exempt
			assert.isFalse(found.some(([file]) => file === "draft.md"));
		}).pipe(Effect.provide(platformFor("lint/require-verified", MOUNT))),
	);
});
