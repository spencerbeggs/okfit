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
	it.effect("an unquoted 0.10 declares 0.10 and is current; an unquoted 0.2 keeps the fallbacks (#467)", () =>
		Effect.gen(function* () {
			const load = (version: string) =>
				Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(
						platform({
							[`${MOUNT}/index.md`]: `---\nokf_version: ${version}\n---\n\n# Note\n\n* [A](a.md)\n`,
							[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
						}),
					),
				);
			const tenth = yield* load("0.10");
			assert.deepStrictEqual(OkfVersion.declared(tenth), Option.some("0.10"));
			assert.isFalse(OkfVersion.legacyFallbacks(tenth));
			const second = yield* load("0.2");
			assert.deepStrictEqual(OkfVersion.declared(second), Option.some("0.2"));
			assert.isTrue(OkfVersion.legacyFallbacks(second));
			const twentieth = yield* load("0.20");
			assert.deepStrictEqual(OkfVersion.declared(twentieth), Option.some("0.20"));
			assert.isFalse(OkfVersion.legacyFallbacks(twentieth));
			// control: the quoted '0.10' declares the same version, without the warning
			const quoted = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(
					platform({
						[`${MOUNT}/index.md`]: "---\nokf_version: '0.10'\n---\n\n# Note\n\n* [A](a.md)\n",
						[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					}),
				),
			);
			assert.deepStrictEqual(OkfVersion.declared(quoted), OkfVersion.declared(tenth));
			assert.strictEqual(quoted.diagnostics.length, 0);
			assert.deepStrictEqual(
				tenth.diagnostics.map((d) => [d.code, d.message]),
				[
					[
						"index-metadata-invalid",
						'okf_version 0.10 is an unquoted number, which YAML reads as 0.1; quote it as "0.10"',
					],
				],
			);
		}),
	);
	it.effect("a declaration with no readable version text reads as current (#467, OKF 0.3 §12)", () =>
		Effect.gen(function* () {
			for (const value of ["true", "[0.2]", "{ a: 1 }"]) {
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(
						platform({
							[`${MOUNT}/index.md`]: `---\nokf_version: ${value}\n---\n\n# Note\n\n* [A](a.md)\n`,
							[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
						}),
					),
				);
				assert.isTrue(Option.isSome(OkfVersion.declared(bundle)), value);
				assert.isFalse(OkfVersion.legacyFallbacks(bundle), value);
			}
		}),
	);
	it.effect("an unquoted version in CRLF frontmatter with a trailing comment is read by its own text (#467)", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(
					platform({
						[`${MOUNT}/index.md`]:
							"---\r\ntitle: T\r\nokf_version: 0.10 # note\r\n---\r\n\r\n# Note\r\n\r\n* [A](a.md)\r\n",
						[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
					}),
				),
			);
			assert.deepStrictEqual(OkfVersion.declared(bundle), Option.some("0.10"));
			assert.isFalse(OkfVersion.legacyFallbacks(bundle));
		}),
	);
	it.effect("an unquoted number that is not a <major>.<minor> pair declares its text and reads as current (#467)", () =>
		Effect.gen(function* () {
			for (const text of [".2", "0.2e0", "+0.3", "1e1"]) {
				const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(
						platform({
							[`${MOUNT}/index.md`]: `---\nokf_version: ${text}\n---\n\n# Note\n\n* [A](a.md)\n`,
							[`${MOUNT}/a.md`]: "---\ntype: Note\n---\n",
						}),
					),
				);
				assert.deepStrictEqual(OkfVersion.declared(bundle), Option.some(text), text);
				assert.isFalse(OkfVersion.legacyFallbacks(bundle), text);
				assert.deepStrictEqual(
					bundle.diagnostics.map((d) => d.code),
					["index-metadata-invalid"],
					text,
				);
			}
		}),
	);
});
