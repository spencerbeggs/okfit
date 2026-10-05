import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Workspaces } from "@effected/workspaces";
import type { PackedInstallOptions } from "@effected/workspaces/testing";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, FileSystem, Layer } from "effect";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
// PackedInstall packs `dist/prod/npm/pkg` (the release artifact); without the
// prod build there is nothing to pack and the suite skips. POSIX-only.
const BUILT = existsSync(join(ROOT, "packages", "cli", "dist", "prod", "npm", "pkg", "package.json"));
const RUNNABLE = BUILT && process.platform !== "win32";

const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * `@okfit/cli` installed ON ITS OWN, not through the `@okfit/plugin` carrier
 * (that is `packages/plugin/__test__/e2e/packed-install.e2e.test.ts`): the
 * package is the carrier here and the sole declarer of `okfit`. A smoke test
 * only; the many-case suites in this directory stay on the dev dist.
 */
const RUN: PackedInstallOptions = {
	carrier: "@okfit/cli",
	closure: "auto",
	managers: ["npm", "pnpm", "yarn", "bun"],
	bins: ["okfit"],
	// FORCE_COLOR beats NO_COLOR and the TTY check since @effected/cli 0.11 (okfit #232).
	env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
	// CI provisions every manager, so a missing one fails there; locally it is skipped.
	require: process.env.CI ? "all" : "any",
	installTimeout: "3 minutes",
	packTimeout: "30 seconds",
};

const PACKED = RUNNABLE
	? await Effect.runPromise(PackedInstall.closure(RUN.carrier, RUN).pipe(Effect.provide(Live)))
	: [];
const BUDGET = PackedInstall.timeoutBudget({
	managers: RUN.managers,
	installTimeout: RUN.installTimeout,
	packTimeout: RUN.packTimeout,
	packages: PACKED,
	perConsumer: "2 minutes",
});

describe.skipIf(!RUNNABLE)("packed install (@okfit/cli)", () => {
	layer(Live, { excludeTestServices: true })((it) => {
		it.effect(
			"okfit from the packed tarballs runs under every available manager",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const result = yield* PackedInstall.run(RUN);
					assert.deepStrictEqual(Object.keys(result.tarballs), [...PACKED]);
					assert.isAbove(result.consumers.length, 0);
					const env = { XDG_DATA_HOME: `${result.scratch}/xdg`, XDG_STATE_HOME: `${result.scratch}/xdg-state` };
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						const version = yield* consumer.runBin("okfit", ["--version"], { env });
						assert.strictEqual(version.exitCode, 0, `${label}: ${version.stderr}`);
						// Installed directly, not through the carrier: no `via` suffix.
						assert.match(
							version.stdout.trim(),
							/^okfit \d+\.\d+\.\d+ \(engine \d+\.\d+\.\d+, okf 0\.2, config-schema 1\.0\)$/,
							label,
						);
						assert.strictEqual(version.stderr, "", label);

						// A bundle-less directory takes the error-envelope path; a direct install reports no distribution.
						const cwd = `${result.scratch}/empty-${label}`;
						yield* fs.makeDirectory(cwd, { recursive: true });
						const validate = yield* consumer.runBin("okfit", ["validate", "--format", "json"], { env, cwd });
						const envelope = JSON.parse(validate.stdout) as { readonly distribution: unknown };
						assert.strictEqual(envelope.distribution, null, label);

						// The sole declarer owns the slot where a symlink is written (pnpm writes shims).
						const provenance = yield* consumer.binProvenance("okfit");
						assert.strictEqual(provenance?.package, label === "pnpm" ? undefined : "@okfit/cli", label);
					}
				}).pipe(Effect.scoped, Effect.timeout(BUDGET)),
			Duration.toMillis(BUDGET) + 60_000,
		);
	});
});
