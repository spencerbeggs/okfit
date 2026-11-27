import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Bundle } from "../src/Bundle.js";
import { OkfVersion } from "../src/OkfVersion.js";
import { MOUNT, platform } from "./utils/fixtures.js";

describe("OkfVersion", () => {
	it("parses <major>.<minor> numerically and nothing else (OKF 0.3 §12, D2)", () => {
		assert.deepStrictEqual(OkfVersion.parse("0.3"), Option.some({ major: 0, minor: 3 }));
		assert.deepStrictEqual(OkfVersion.parse("0.10"), Option.some({ major: 0, minor: 10 }));
		for (const raw of ["1", "0.3.1", "v0.3", " 0.3", "0.x", ""]) {
			assert.isTrue(Option.isNone(OkfVersion.parse(raw)), raw);
		}
	});
	it("compares numerically, not lexically", () => {
		assert.strictEqual(OkfVersion.compare({ major: 0, minor: 2 }, { major: 0, minor: 3 }), -1);
		assert.strictEqual(OkfVersion.compare({ major: 0, minor: 10 }, { major: 0, minor: 9 }), 1);
		assert.strictEqual(OkfVersion.compare({ major: 1, minor: 0 }, { major: 0, minor: 99 }), 1);
		assert.strictEqual(OkfVersion.compare({ major: 0, minor: 3 }, { major: 0, minor: 3 }), 0);
	});
	it("allows the v0.2 fallbacks for 0.2 or earlier and for no declaration; an unparsable version reads as current", () => {
		assert.isTrue(OkfVersion.allowsLegacyFallbacks(Option.none()));
		assert.isTrue(OkfVersion.allowsLegacyFallbacks(Option.some("0.2")));
		assert.isTrue(OkfVersion.allowsLegacyFallbacks(Option.some("0.1")));
		assert.isFalse(OkfVersion.allowsLegacyFallbacks(Option.some("0.3")));
		assert.isFalse(OkfVersion.allowsLegacyFallbacks(Option.some("1.0")));
		assert.isFalse(OkfVersion.allowsLegacyFallbacks(Option.some("garbage")));
	});
	it.effect("declared reads the bundle-root index only", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.deepStrictEqual(OkfVersion.declared(bundle), Option.some("0.3"));
			assert.isFalse(OkfVersion.legacyFallbacks(bundle));
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/index.md`]: '---\nokf_version: "0.3"\n---\n\n# Note\n\n* [A](a.md)\n',
					[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
				}),
			),
		),
	);
	it.effect("declares nothing without a root index, even when a nested index declares a version", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			assert.isTrue(Option.isNone(OkfVersion.declared(bundle)));
			assert.isTrue(OkfVersion.legacyFallbacks(bundle));
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/sub/index.md`]: '---\nokf_version: "0.3"\n---\n\n# Sub\n\n* [A](a.md)\n',
					[`${MOUNT}/sub/a.md`]: "---\ntype: Note\n---\n",
				}),
			),
		),
	);
	it.effect("a quoted '0.10' declares 0.10 and is current (#467)", () =>
		Effect.gen(function* () {
			const load = (version: string) =>
				Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(
						platform({
							[`${MOUNT}/index.md`]: `---\nokf_version: '${version}'\n---\n\n# Note\n\n* [A](a.md)\n`,
							[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
						}),
					),
				);
			const current = yield* load("0.10");
			assert.deepStrictEqual(OkfVersion.declared(current), Option.some("0.10"));
			assert.isFalse(OkfVersion.legacyFallbacks(current));
			assert.deepStrictEqual(
				current.diagnostics.filter((d) => d.file === "index.md"),
				[],
			);
			// control: a quoted '0.2' keeps the fallbacks
			const legacy = yield* load("0.2");
			assert.deepStrictEqual(OkfVersion.declared(legacy), Option.some("0.2"));
			assert.isTrue(OkfVersion.legacyFallbacks(legacy));
		}),
	);
});
