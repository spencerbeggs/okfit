import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { OKF_BUNDLES, OKF_MOUNT, okfBundlePlatform, okfBundleSeed } from "./utils/fixtures.js";

// Counts recorded in fixtures/okf/VENDORED.md; guards against a silently-empty vendoring.
const EXPECTED = {
	acme_retail: { files: 18, md: 17, index: 7, log: 1 },
	crypto_bitcoin: { files: 15, md: 15, index: 6, log: 0 },
	ga4: { files: 14, md: 14, index: 5, log: 0 },
	stackoverflow: { files: 32, md: 32, index: 6, log: 0 },
} as const;

const AcmePlatform = okfBundlePlatform("acme_retail");

describe("vendored OKF corpus guard", () => {
	for (const bundle of OKF_BUNDLES) {
		it(`seeds ${bundle} with the recorded file counts`, () => {
			const keys = Object.keys(okfBundleSeed(bundle));
			const expected = EXPECTED[bundle];
			assert.strictEqual(keys.length, expected.files);
			assert.strictEqual(keys.filter((key) => key.endsWith(".md")).length, expected.md);
			assert.strictEqual(keys.filter((key) => key.endsWith("/index.md")).length, expected.index);
			assert.strictEqual(keys.filter((key) => key.endsWith("/log.md")).length, expected.log);
			for (const key of keys)
				assert.isTrue(key.startsWith(`${OKF_MOUNT}/${bundle}/`) && !key.endsWith("viz.html"), key);
		});
	}

	it.effect("reads seeded files back through FileSystem", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const index = yield* fs.readFileString(`${OKF_MOUNT}/acme_retail/index.md`);
			assert.isTrue(index.startsWith("# Subdirectories\n"));
			assert.isTrue(yield* fs.exists(`${OKF_MOUNT}/acme_retail/attesters/sql_equality.py`));
			const entries = yield* fs.readDirectory(`${OKF_MOUNT}/acme_retail`);
			assert.deepStrictEqual([...entries].sort(), [
				"attesters",
				"computations",
				"index.md",
				"log.md",
				"metrics",
				"policies",
				"skills",
				"tables",
			]);
		}).pipe(Effect.provide(AcmePlatform)),
	);
});
