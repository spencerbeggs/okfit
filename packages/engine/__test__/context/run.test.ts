import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect, Layer } from "effect";
import { runContext } from "../../src/context/run.js";
import { recordCalls, seedPlatform } from "../utils/bundle.js";

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

describe("runContext and a symlinked index.md (OKF 0.3 section 3.2)", () => {
	const BUNDLE = "/repo/okf";
	const INDEX = `${BUNDLE}/index.md`;
	const seeds = {
		plain: { [INDEX]: "# Index\n" },
		escaping: { "/outside/index.md": "# SECRET\n", [INDEX]: MemoryFileSystem.symlink("/outside/index.md") },
		dangling: { [INDEX]: MemoryFileSystem.symlink("/outside/missing.md") },
		inside: { [`${BUNDLE}/real.md`]: "# Index\n", [INDEX]: MemoryFileSystem.symlink(`${BUNDLE}/real.md`) },
	} as const;
	const run = (kind: keyof typeof seeds) => {
		const calls: Array<string> = [];
		return runContext({ bundleRoot: BUNDLE }).pipe(
			Effect.map((result) => ({ result, calls })),
			Effect.provide(seedPlatform(seeds[kind], recordCalls(calls))),
		);
	};

	it.effect("reports a plain index.md and an in-bundle symlinked index.md present (controls)", () =>
		Effect.gen(function* () {
			for (const kind of ["plain", "inside"] as const) {
				const { result, calls } = yield* run(kind);
				assert.isTrue(result.indexExists, kind);
				// The recorder is armed: the existence check on the index is observed.
				assert.isTrue(
					calls.some((call) => call.startsWith(`exists ${INDEX}`)),
					kind,
				);
			}
		}),
	);

	it.effect("reports an index.md linked outside the bundle, or dangling, absent and never reads the link", () =>
		Effect.gen(function* () {
			for (const kind of ["escaping", "dangling"] as const) {
				const { result, calls } = yield* run(kind);
				assert.strictEqual(result.indexPath, INDEX, kind);
				assert.isFalse(result.indexExists, kind);
				assert.deepStrictEqual(
					calls.filter((call) => /^(exists|stat|readFile|readFileString|open) /.test(call)),
					[],
					kind,
				);
			}
		}),
	);
});
