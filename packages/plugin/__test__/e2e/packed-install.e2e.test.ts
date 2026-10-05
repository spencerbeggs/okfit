import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Run } from "@effected/commands";
import { McpProbe } from "@effected/mcp/testing";
import { Workspaces } from "@effected/workspaces";
import type { PackedInstallOptions } from "@effected/workspaces/testing";
import { PackedInstall } from "@effected/workspaces/testing";
import { Duration, Effect, FileSystem, Layer, Stream } from "effect";
import { ChildProcess } from "effect/process";

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
// PackedInstall packs `dist/prod/npm/pkg` (the release artifact), so the suite
// needs the prod build; without it there is nothing to pack and it skips.
const BUILT = existsSync(join(ROOT, "packages", "plugin", "dist", "prod", "npm", "pkg", "package.json"));
// PackedInstall is POSIX-only.
const RUNNABLE = BUILT && process.platform !== "win32";

const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * ONE options object: `closure` plans with it, `run` installs with it. The
 * three front ends declare the same bin names as this carrier on purpose
 * (they are also installed and run alone), so `allowSharedBins` is set and
 * the carrier's own shims are proven with `runCarrierBin`.
 */
const RUN: PackedInstallOptions = {
	carrier: "@okfit/plugin",
	closure: "auto",
	managers: ["npm", "pnpm", "yarn", "bun"],
	bins: ["okfit", "okfit-mcp", "okfit-lsp"],
	allowSharedBins: true,
	// FORCE_COLOR beats NO_COLOR and the TTY check since @effected/cli 0.11; a CI
	// runner exporting it would colour the output asserted below (okfit #232).
	env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
	// CI provisions every manager, so a missing one fails there; locally it is skipped.
	require: process.env.CI ? "all" : "any",
	installTimeout: "3 minutes",
	packTimeout: "30 seconds",
};

// Module evaluation, before `describe` runs: the names the run will pack.
const PACKED = RUNNABLE
	? await Effect.runPromise(PackedInstall.closure(RUN.carrier, RUN).pipe(Effect.provide(Live)))
	: [];
const BUDGET = PackedInstall.timeoutBudget({
	managers: RUN.managers,
	installTimeout: RUN.installTimeout,
	packTimeout: RUN.packTimeout,
	packages: PACKED,
	// Per consumer: a --version run per bin, a validate run, an MCP and an LSP handshake.
	perConsumer: "3 minutes",
});

const frame = (message: unknown) => {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

const LSP_STDIN = [
	frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: null, capabilities: {} } }),
	frame({ jsonrpc: "2.0", method: "initialized", params: {} }),
	frame({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null }),
	frame({ jsonrpc: "2.0", method: "exit", params: null }),
].join("");

/**
 * Which package owns each `.bin` slot under shared bins, observed on npm 11,
 * pnpm 12, Yarn 4 and bun 1: npm and bun link the front end whose name sorts
 * before `@okfit/plugin`, Yarn keeps the carrier (the consumer's direct
 * dependency), and pnpm writes shell shims (`undefined`). A change here means
 * a manager changed which package wins the slot -- the carrier's own shim is
 * still proven by `runCarrierBin`, so update this table rather than the bins.
 */
const SLOT_OWNER: Record<"npm" | "pnpm" | "yarn" | "bun", Record<string, string | undefined>> = {
	npm: { okfit: "@okfit/cli", "okfit-mcp": "@okfit/mcp", "okfit-lsp": "@okfit/lsp" },
	bun: { okfit: "@okfit/cli", "okfit-mcp": "@okfit/mcp", "okfit-lsp": "@okfit/lsp" },
	yarn: { okfit: "@okfit/plugin", "okfit-mcp": "@okfit/plugin", "okfit-lsp": "@okfit/plugin" },
	pnpm: { okfit: undefined, "okfit-mcp": undefined, "okfit-lsp": undefined },
};

const VERSION =
	/^okfit \d+\.\d+\.\d+ via @okfit\/plugin \d+\.\d+\.\d+ \(engine \d+\.\d+\.\d+, okf 0\.2, config-schema 1\.0\)$/;

describe.skipIf(!RUNNABLE)("packed install (@okfit/plugin)", () => {
	layer(Live, { excludeTestServices: true })((it) => {
		it.effect(
			"the carrier's bins work from a packed install under every available manager",
			() =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const result = yield* PackedInstall.run(RUN);
					assert.deepStrictEqual(Object.keys(result.tarballs), [...PACKED]);
					assert.isAbove(result.consumers.length, 0);
					yield* Effect.log(`packed ${PACKED.length} packages; unavailable: [${result.unavailable.join(", ")}]`);
					// Per-run state lives inside the scratch root and is removed with it.
					const env = { XDG_DATA_HOME: `${result.scratch}/xdg`, XDG_STATE_HOME: `${result.scratch}/xdg-state` };
					for (const consumer of result.consumers) {
						const label = consumer.manager;
						// What a user typing the bin name gets: SOME package's bin runs.
						const typed = yield* consumer.runBin("okfit", ["--version"], { env });
						assert.strictEqual(typed.exitCode, 0, `${label}: ${typed.stderr}`);

						// The carrier's own shim, whichever package took the .bin slot.
						const own = yield* consumer.runCarrierBin("okfit", ["--version"], { env });
						assert.strictEqual(own.exitCode, 0, `${label}: ${own.stderr}`);
						assert.match(own.stdout.trim(), VERSION, label);

						// A report learns it came through the carrier.
						const cwd = `${result.scratch}/empty-${label}`;
						yield* fs.makeDirectory(cwd, { recursive: true });
						const validate = yield* consumer.runCarrierBin("okfit", ["validate", "--format", "json"], { env, cwd });
						const envelope = JSON.parse(validate.stdout) as { readonly distribution: { readonly name: string } };
						assert.strictEqual(envelope.distribution.name, "@okfit/plugin", label);

						// MCP: initialize handshake, clean stderr, clean exit.
						const mcp = yield* consumer.carrierCommand("okfit-mcp", [], { env });
						const probe = yield* McpProbe.initialize(mcp).pipe(Effect.timeout("30 seconds"));
						assert.isUndefined(probe.response.error, label);
						assert.strictEqual(probe.exitCode, 0, `${label}: ${probe.stderr}`);

						// LSP: initialize, shutdown, exit over framed stdio.
						const lspBase = yield* consumer.carrierCommand("okfit-lsp", ["--stdio"], { env });
						const lsp = yield* Run.collect(
							ChildProcess.make(lspBase.command, lspBase.args, {
								...lspBase.options,
								stdin: Stream.make(new TextEncoder().encode(LSP_STDIN)),
							}),
						);
						assert.strictEqual(lsp.exitCode, 0, `${label}: ${lsp.stderr}`);
						assert.include(lsp.stdout, '"name":"okfit-lsp"', label);
						assert.include(lsp.stderr, "via @okfit/plugin", label);

						// Who owns each .bin slot under shared bins.
						for (const bin of RUN.bins) {
							const provenance = yield* consumer.binProvenance(bin);
							assert.strictEqual(provenance?.package, SLOT_OWNER[consumer.manager][bin], `${label} .bin/${bin}`);
						}
					}
				}).pipe(Effect.scoped, Effect.timeout(BUDGET)),
			// vitest's own guard a minute above the Effect's, so a named PackedInstallError fires first.
			Duration.toMillis(BUDGET) + 60_000,
		);
	});
});
