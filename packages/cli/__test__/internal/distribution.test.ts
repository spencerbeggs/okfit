import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Distribution } from "../../src/internal/distribution.js";

describe("Distribution", () => {
	it.effect("defaults to Option.none() when nothing provides it", () =>
		Effect.gen(function* () {
			const distribution = yield* Distribution;
			assert.isTrue(Option.isNone(distribution));
		}),
	);

	it.effect("reads back the value main() provides", () =>
		Effect.gen(function* () {
			const distribution = yield* Distribution;
			assert.deepStrictEqual(distribution, Option.some({ name: "@okfit/plugin", version: "0.3.7" }));
		}).pipe(Effect.provideService(Distribution, Option.some({ name: "@okfit/plugin", version: "0.3.7" }))),
	);
});
