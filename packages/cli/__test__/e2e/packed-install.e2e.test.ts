import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it, layer } from "@effect/vitest";
import { Workspaces } from "@effected/workspaces";
import type { PackedInstallOptions } from "@effected/workspaces/testing";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, FileSystem, Layer } from "effect";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

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
	// While a dogfood loop links an unreleased sibling build (`file:` overrides in pnpm-workspace.yaml), the
	// consumers get that build too; with no such override this reads nothing.
	workspaceOverrides: true,
	// CI provisions npm, pnpm and bun (root devEngines), so they are required there; yarn is opportunistic locally.
	managers: process.env.CI ? ["npm", "pnpm", "bun"] : ["npm", "pnpm", "bun", "yarn"],
	bins: ["okfit"],
	// FORCE_COLOR beats NO_COLOR and the TTY check since @effected/cli 0.11 (okfit #232).
	env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
	// A missing manager fails in CI; locally any one that is installed is enough.
	require: process.env.CI ? "all" : "any",
	installTimeout: "3 minutes",
	packTimeout: "30 seconds",
};

// Module evaluation, before `describe` runs. PackedInstall packs `dist/prod/npm/pkg` (the release
// artifact): with it absent the suite skips locally and FAILS under CI (a silent skip would stop
// proving the published tarballs). The gate reads `CI` through `Config`.
const GATE = await Effect.runPromise(
	PackedInstall.preflight(RUN).pipe(Effect.flatMap(PackedInstall.gate), Effect.provide(Live)),
);
// PackedInstall is POSIX-only.
const RUNNABLE = GATE.action === "run" && process.platform !== "win32";

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

describe.runIf(GATE.action === "fail")("packed install (@okfit/cli) prod build", () => {
	it("dist/prod exists (run `pnpm turbo run build:prod` before the tests)", () => {
		assert.fail(GATE.message);
	});
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
