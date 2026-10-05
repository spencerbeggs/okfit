import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect, Layer } from "effect";
import { runContext } from "../../src/context/run.js";

// K-44: no CLI-owned fixture. Profiles' clean bundle is read IN PLACE, by
// absolute path; this suite only stats a file, it never writes. The "no
// index.md" case below cannot reuse a profiles fixture either -- every
// entry under packages/profiles/__test__/fixtures/bad/ ships its own
// bundle-root index.md (confirmed this session by `find`) -- so it builds
// a throwaway temp directory instead.
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");
const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("runContext", () => {
	it.effect("reports indexExists true against a bundle root with an index.md", () =>
		Effect.gen(function* () {
			const bundleRoot = resolve(PROFILES_FIXTURES, "software-project", "okf");
			const result = yield* runContext({ bundleRoot });
			assert.strictEqual(result.indexPath, resolve(bundleRoot, "index.md"));
			assert.isTrue(result.indexExists);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("reports indexExists false against a bundle root that exists but has no index.md", () =>
		Effect.gen(function* () {
			const bundleRoot = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-cli-context-run-")));
			yield* Effect.promise(() => writeFile(join(bundleRoot, "other.md"), "not an index\n", "utf8"));
			const result = yield* runContext({ bundleRoot });
			assert.strictEqual(result.indexPath, resolve(bundleRoot, "index.md"));
			assert.isFalse(result.indexExists);
			yield* Effect.promise(() => rm(bundleRoot, { recursive: true, force: true }));
		}).pipe(Effect.provide(platform)),
	);

	it.effect("reports indexExists false against a bundle root that does not exist at all", () =>
		Effect.gen(function* () {
			const bundleRoot = resolve(PROFILES_FIXTURES, "does-not-exist-at-all");
			const result = yield* runContext({ bundleRoot });
			assert.isFalse(result.indexExists);
		}).pipe(Effect.provide(platform)),
	);

	it.effect("never references Bundle or Validate from @okfit/core (contract §9.5's structural check)", () =>
		Effect.gen(function* () {
			// `src/context/` holds only run.ts, so this root scopes the scan to it.
			const scan = yield* SourceBoundary.scan({
				root: resolve(import.meta.dirname, "..", "..", "src", "context"),
				rules: [{ forbidTokens: ["Bundle", "Validate"] }],
			});
			// Non-vacuity: a typo'd root must not report a spotless boundary.
			assert.deepStrictEqual(
				scan.files.map((file) => file.replaceAll("\\", "/").split("/").pop()),
				["run.ts"],
			);
			assert.deepStrictEqual(scan.violations, []);
		}).pipe(Effect.provide(platform)),
	);
});
