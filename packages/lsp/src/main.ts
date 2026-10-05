/**
 * The assembled okfit LSP server program.
 *
 * @packageDocumentation
 */

import { ProcessGuard } from "@effected/engine/guard";
import type { Distribution } from "@okfit/engine";

/**
 * Options `@okfit/plugin`'s `okfit-lsp` bin shim (and only it, today) passes
 * to {@link main}. `distribution` names the meta-package the server was
 * launched through; omitted for a direct install of `@okfit/lsp`.
 *
 * @public
 */
export interface MainOptions {
	readonly distribution?: Distribution;
}

/**
 * Run the okfit LSP server over stdio. Owns the process.
 *
 * `ProcessGuard.run` (`@effected/engine/guard`, itself free of static runtime
 * imports) installs the crash guards before `load` evaluates the server
 * graph, so a throw during module evaluation is still reported on stderr
 * rather than crashing silently. This module therefore carries no other
 * static runtime import (`Distribution` is type-only); adding one would
 * defeat that.
 *
 * Policy is `exitBeforeConnect` for both events, the same as
 * `packages/mcp/src/main.ts`. Before the transport is up a stray error means
 * a broken boot, so the guard exits `1`. Once serving, every answer is derived
 * from the bundle on disk and the client's open documents, and Claude Code
 * does not reliably respawn a language server that exits, so dying on a stray
 * error would silently take every diagnostic away; the guard logs it to stderr
 * and keeps serving. A `load()` that rejects is `startup failed`, exit `1`,
 * whatever the policy.
 *
 * `makeReferenceTransport` is built with `streams` set to `process.stdin`
 * and `process.stdout` explicitly: without `streams` the library falls
 * back to its own node-entry argv handling and calls `process.exit` itself
 * from a `finally`, before `listen` ever resolves (`protocol/reference.ts`).
 * With `streams`, the transport owns the lifecycle and `listen` resolves
 * with a `ListenOutcome` this module maps to an exit code itself. `--stdio`
 * on the command line is therefore accepted and ignored; `--node-ipc`,
 * `--socket` and `--pipe`, which only make sense for the library's own argv
 * handling, are not supported.
 *
 * @public
 */
export const main = (options: MainOptions = {}): Promise<void> =>
	ProcessGuard.run({
		label: "okfit-lsp",
		host: process,
		policy: { onUncaught: "exitBeforeConnect", onRejection: "exitBeforeConnect" },
		// Test-only: the e2e suite sets it to raise one stray crash before
		// `load()` or once serving. Never set in a normal install.
		injectCrash: ProcessGuard.parseInjectCrash(process.env.OKFIT_LSP_TEST_INJECT_CRASH),
		load: async (guard) => {
			// No static imports of the server graph above this line.
			const [
				NodeRuntime,
				{ LspStdio },
				{ OkfitPlatform },
				{ Git },
				{ GitHistory },
				{ Effect, Layer, Logger },
				{ makeReferenceTransport },
				{ serve },
			] = await Promise.all([
				import("@effect/platform-node/NodeRuntime"),
				import("@effected/lsp"),
				import("@okfit/engine"),
				import("@effected/git"),
				import("@okfit/profiles"),
				import("effect"),
				import("./protocol/reference.js"),
				import("./server.js"),
			]);

			const program = Effect.gen(function* () {
				const transport = yield* makeReferenceTransport({ streams: { input: process.stdin, output: process.stdout } });
				// The transport owns stdin/stdout from here: a stray error now is a
				// serving error, not a broken boot.
				guard.markConnected();
				// A `ListenOutcome` is already an `LspSessionEnd`: `LspStdio` maps it to
				// the exit code (`1` only for `exit` without `shutdown`).
				return yield* serve(transport, options);
			}).pipe(
				Effect.scoped,
				Effect.provide(Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(OkfitPlatform))),
				// `consolePretty` honours `LogToStderr`, which `LspStdio.launch`
				// provides around the whole program, so no log line reaches stdout,
				// the JSON-RPC wire.
				Effect.provide(Logger.layer([Logger.consolePretty()])),
			);

			// `launch` reports a launch failure on stderr (`runMain` would write it
			// to stdout) and `teardown` always ends the process with the exit code:
			// a code-0 exit would otherwise wait on stdin, which the client never
			// closes first.
			NodeRuntime.runMain(LspStdio.launch(program), { teardown: LspStdio.teardown(process) });
		},
	});
