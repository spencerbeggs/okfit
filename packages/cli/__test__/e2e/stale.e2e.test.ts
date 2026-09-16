// Acceptance suite for `okfit stale` (issue #17): same handler skeleton as
// `okfit validate`/`okfit context`, diverging into `@okfit/engine`'s
// `runStale`. Spawns the built dist/dev bin (K-43), never Command.run
// in-process, per this package's e2e convention.
//
// K-44/decision 3 (mirrors validate.e2e.test.ts's own OKFIT_NOW case): no
// shipped bad-bundle fixture sets `stale_after`, so this patches a copy of
// the clean software-project fixture with one instead of duplicating a
// fixture category.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { copyFixtureInto, makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");
const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");

/** Patches `modules/core.md` with a past `stale_after`; `decisions/effect-v4.md` is left alone (fresh/none). */
const seedStaleBundle = (sandbox: { readonly cwd: string }) =>
	Effect.gen(function* () {
		const bundleRoot = join(sandbox.cwd, "okf");
		yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
		const concept = join(bundleRoot, "modules", "core.md");
		const original = yield* Effect.promise(() => readFile(concept, "utf8"));
		yield* Effect.promise(() =>
			writeFile(
				concept,
				original.replace("tags: [architecture]\n---", "tags: [architecture]\nstale_after: 2025-01-01T00:00:00Z\n---"),
				"utf8",
			),
		);
		return bundleRoot;
	});

describe("okfit stale: OKFIT_NOW", () => {
	it.effect("lists nothing before stale_after and the one stale concept after it (K-47)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* seedStaleBundle(sandbox);

			const before = yield* runOkfit(["stale"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2024-01-01T00:00:00Z" },
			});
			assert.strictEqual(before.exitCode, 0);
			assert.strictEqual(before.stdout, "");
			assert.strictEqual(before.stderr, "0 stale concepts of 16 in okf\n");

			const after = yield* runOkfit(["stale"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2026-01-01T00:00:00Z" },
			});
			assert.strictEqual(after.exitCode, 0);
			assert.strictEqual(after.stdout, "modules/core  2025-01-01T00:00:00.000Z  (365 days past)\n");
			assert.strictEqual(after.stderr, "1 stale concepts of 16 in okf\n");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit stale --format json", () => {
	it.effect("deep-equals a fully specified envelope: schema 1, as_of, items sorted by id", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* seedStaleBundle(sandbox);

			const result = yield* runOkfit(["stale", "--format", "json"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2026-01-01T00:00:00Z" },
			});

			assert.strictEqual(result.exitCode, 0);
			const bundleRoot = join(sandbox.cwd, "okf");
			const {
				okfit_version: reportedVersion,
				engine_version: engineVersion,
				...envelope
			} = JSON.parse(result.stdout) as Record<string, unknown>;
			assert.match(String(reportedVersion), /^\d+\.\d+\.\d+/);
			assert.match(String(engineVersion), /^\d+\.\d+\.\d+/);
			assert.deepStrictEqual(envelope, {
				schema: 1,
				producer: "okfit",
				distribution: null,
				okf_version: "0.2",
				root: bundleRoot,
				profile: "software-project",
				as_of: "2026-01-01T00:00:00.000Z",
				summary: { concepts: 16, stale: 1 },
				items: [{ id: "modules/core", stale_after: "2025-01-01T00:00:00.000Z", days_past: 365 }],
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("exit 3 under json still gets the K-22 error envelope on stdout", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["stale", "--format", "json", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly exit_code: number;
				readonly error: { readonly tag: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigPathNotFoundError");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
