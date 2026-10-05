import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { McpProbe } from "@effected/mcp/testing";
import { Workspaces } from "@effected/workspaces";
import type { PackedInstallOptions } from "@effected/workspaces/testing";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, Layer } from "effect";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
// PackedInstall packs `dist/prod/npm/pkg` (the release artifact); without the
// prod build there is nothing to pack and the suite skips. POSIX-only.
const BUILT = existsSync(join(ROOT, "packages", "mcp", "dist", "prod", "npm", "pkg", "package.json"));
const RUNNABLE = BUILT && process.platform !== "win32";

const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * `@okfit/mcp` installed ON ITS OWN, not through the `@okfit/plugin` carrier
 * (that is `packages/plugin/__test__/e2e/packed-install.e2e.test.ts`): the
 * package is the carrier here, so its `okfit-mcp` bin is the only declarer
 * and no `allowSharedBins` is needed. The fast, many-case suite in
 * `server-lifecycle.e2e.test.ts` stays on the dev dist.
 */
const RUN: PackedInstallOptions = {
	carrier: "@okfit/mcp",
	closure: "auto",
	managers: ["npm", "pnpm", "yarn", "bun"],
	bins: ["okfit-mcp"],
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

describe.skipIf(!RUNNABLE)("packed install (@okfit/mcp)", () => {
	layer(Live, { excludeTestServices: true })((it) => {
		it.effect(
			"okfit-mcp from the packed tarballs completes an initialize handshake under every available manager",
			() =>
				Effect.gen(function* () {
					const result = yield* PackedInstall.run(RUN);
					assert.deepStrictEqual(Object.keys(result.tarballs), [...PACKED]);
					assert.isAbove(result.consumers.length, 0);
					// Point the server at the repo's own bundle; state stays in the scratch root.
					const env = { OKFIT_PROJECT_DIR: ROOT, XDG_DATA_HOME: `${result.scratch}/xdg` };
					for (const consumer of result.consumers) {
						const probe = yield* McpProbe.initialize(consumer.command("okfit-mcp", [], { env })).pipe(
							Effect.timeout("30 seconds"),
						);
						assert.isUndefined(probe.response.error, consumer.manager);
						assert.strictEqual(probe.exitCode, 0, `${consumer.manager}: ${probe.stderr}`);
						// The sole declarer owns the slot where a symlink is written (pnpm writes shims).
						const provenance = yield* consumer.binProvenance("okfit-mcp");
						assert.strictEqual(provenance?.package, consumer.manager === "pnpm" ? undefined : "@okfit/mcp");
					}
				}).pipe(Effect.scoped, Effect.timeout(BUDGET)),
			Duration.toMillis(BUDGET) + 60_000,
		);
	});
});
