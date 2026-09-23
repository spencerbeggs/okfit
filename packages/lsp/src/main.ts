/**
 * The assembled okfit LSP server program.
 *
 * @packageDocumentation
 */

import type { Distribution } from "@okfit/engine";

const FATAL_FALLBACK = "okfit-lsp: a fatal error occurred and could not be described.";

const describe = (error: unknown): string => {
	try {
		if (error instanceof Error) return error.stack ?? error.message;
		return String(error);
	} catch {
		return FATAL_FALLBACK;
	}
};

const fatal = (label: string, error: unknown): never => {
	process.stderr.write(`okfit-lsp: ${label}: ${describe(error)}\n`);
	process.exit(1);
};

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
 * This module deliberately carries NO static imports of the server graph:
 * the `uncaughtException` and `unhandledRejection` handlers are registered
 * before `NodeRuntime`, the logger and `serve`'s program are ever evaluated,
 * so a throw during module evaluation is still reported on stderr rather
 * than crashing silently. Adding a static import here would defeat that --
 * `Distribution` above is a type-only import, so it carries no runtime
 * import at all.
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
export const main = async (options: MainOptions = {}): Promise<void> => {
	process.on("uncaughtException", (error) => fatal("uncaught exception", error));
	process.on("unhandledRejection", (reason) => fatal("unhandled rejection", reason));

	const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
	const { OkfitPlatform } = await import("@okfit/engine");
	const { Git } = await import("@effected/git");
	const { GitHistory } = await import("@okfit/profiles");
	const { Cause, Effect, Exit, Layer, Logger, Runtime } = await import("effect");
	const { makeReferenceTransport } = await import("./protocol/reference.js");
	const { serve } = await import("./server.js");

	const program = Effect.gen(function* () {
		const transport = yield* makeReferenceTransport({ streams: { input: process.stdin, output: process.stdout } });
		return yield* serve(transport, options);
	}).pipe(
		Effect.scoped,
		Effect.provide(Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(OkfitPlatform))),
		Effect.provide(Logger.layer([Logger.consolePretty()])),
		// See `packages/mcp/src/main.ts` for the full `LogToStderr` rationale:
		// without this reference every log line lands on stdout, the
		// JSON-RPC wire.
		Effect.provide(Layer.succeed(Logger.LogToStderr, true)),
		// An `exit` delivered before the input ends always resolves
		// `reason: "exit"`; `"closed"` means the input ended without one, and
		// maps to 0. Only an `exit` that never saw `shutdown` is a non-clean
		// disconnect.
		Effect.map((outcome) => (outcome.reason === "exit" && !outcome.shutdownReceived ? 1 : 0)),
	);

	NodeRuntime.runMain(program, {
		// `defaultTeardown` (Runtime.ts) reports exit code 130 whenever the
		// main fiber's `Cause` contains only interruptions; map it to 0 so a
		// clean disconnect does not read as a crash. Any other failure keeps
		// the default behaviour -- same split `packages/mcp/src/main.ts` uses.
		//
		// One deviation from that mirror, verified against
		// `@effect/platform-node-shared@4.0.0-rc.117`'s `NodeRuntime.js`: the
		// success and interrupt branches call `process.exit` themselves rather
		// than the `onExit` callback the runner hands in. That callback only
		// calls `process.exit` when the code is non-zero or a signal was
		// received (`code => { if (receivedSignal || code !== 0)
		// process.exit(code); }`) -- for a code-0 success it relies on
		// Node's event loop draining naturally. `process.stdin`, once read,
		// keeps the loop alive on its own even after the LSP `exit`
		// notification's `finish("exit")` has resolved `listen` and this
		// program has completed, so a clean `shutdown` + `exit` sequence
		// with stdin still open (the LSP spec's own contract: the server
		// terminates itself on `exit`, the client is not required to close
		// the pipe) would otherwise hang the process forever at code 0 --
		// reproduced directly against the built bin before this fix, fixed
		// by calling `process.exit` unconditionally here instead.
		teardown: (exit, onExit) => {
			// `Runtime.Teardown`'s own signature is generic (`<E, A>(exit: Exit.Exit<E, A>, onExit: (code: number) =>
			// void) => void`), so inside this literal `exit.value` is typed abstractly as that generic `E`, not
			// concretely as `number` -- even though `program`'s success channel is `number` at every call site. The
			// cast is this well-known higher-order-generic-literal quirk, not a real type hole.
			if (Exit.isSuccess(exit)) {
				process.exit(exit.value as number);
				return;
			}
			if (Cause.hasInterruptsOnly(exit.cause)) {
				process.exit(0);
				return;
			}
			return Runtime.defaultTeardown(exit, onExit);
		},
	});
};
