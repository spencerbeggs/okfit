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

/** What {@link parseInjectCrash} yields: the guard's `injectCrash` option. */
interface InjectCrash {
	readonly at: "load" | "connected";
	readonly kind: "uncaughtException" | "unhandledRejection";
}

const INJECT_AT: ReadonlyArray<InjectCrash["at"]> = ["load", "connected"];
const INJECT_KIND: ReadonlyArray<InjectCrash["kind"]> = ["uncaughtException", "unhandledRejection"];

/**
 * Parse the test-only `OKFIT_LSP_TEST_INJECT_CRASH` value into the guard's
 * `injectCrash`: `<at>:<kind>`, where `at` is `load` or `connected` and
 * `kind` is `uncaughtException` or `unhandledRejection`. Anything else, or
 * no value, is `undefined` (no injection). Only the e2e suite sets it.
 */
const parseInjectCrash = (value: string | undefined): InjectCrash | undefined => {
	if (value === undefined) return undefined;
	const [at, kind, ...rest] = value.split(":");
	if (rest.length > 0) return undefined;
	const validAt = INJECT_AT.find((candidate) => candidate === at);
	const validKind = INJECT_KIND.find((candidate) => candidate === kind);
	return validAt === undefined || validKind === undefined ? undefined : { at: validAt, kind: validKind };
};

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
		injectCrash: parseInjectCrash(process.env.OKFIT_LSP_TEST_INJECT_CRASH),
		load: async (guard) => {
			// No static imports of the server graph above this line.
			const [
				NodeRuntime,
				{ OkfitPlatform },
				{ Git },
				{ GitHistory },
				{ Cause, Effect, Exit, Layer, Logger, Runtime },
				{ makeReferenceTransport },
				{ serve },
			] = await Promise.all([
				import("@effect/platform-node/NodeRuntime"),
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
				const outcome = yield* serve(transport, options);
				// `process.stdin`, once read, keeps the event loop alive on its own; a
				// clean `shutdown` + `exit` sequence leaves stdin still open (the LSP
				// spec's own contract: the server terminates itself on `exit`, the
				// client is not required to close the pipe). `unref` it now that
				// `listen` has resolved; the teardown below still exits explicitly,
				// since stdin is not the only handle that can hold the loop open. Only a
				// pipe or socket stdin (a `net.Socket`) has `unref`; a file or
				// `/dev/null` is an `fs.ReadStream` that reaches EOF by itself and does
				// not hold the loop open, so skipping the call there is safe.
				if (typeof process.stdin.unref === "function") process.stdin.unref();
				return outcome;
			}).pipe(
				Effect.scoped,
				Effect.provide(Layer.mergeAll(Git.layer, GitHistory.layer).pipe(Layer.provideMerge(OkfitPlatform))),
				// Report a launch failure (a layer that cannot build, such as a
				// missing `HOME`) here, inside the logger and `LogToStderr`
				// provisions below. `runMain`'s own report runs outside them, on
				// the default logger, and so writes to stdout -- the JSON-RPC
				// wire. `disableErrorReporting` on `runMain` turns that one off.
				Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(cause))),
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
				// Reported above, on stderr; see the `tapCause` comment.
				disableErrorReporting: true,
				// `defaultTeardown` (Runtime.ts) reports exit code 130 whenever the
				// main fiber's `Cause` contains only interruptions; map it to 0 so a
				// clean disconnect does not read as a crash. Any other failure keeps
				// the default behaviour -- same split `packages/mcp/src/main.ts` uses.
				// On success, `onExit` is handed the program's own mapped code (0 or
				// 1) rather than a hardcoded 0, since unlike the MCP server this one
				// distinguishes a clean disconnect (0) from `exit` without `shutdown`
				// (1); the runner's own `onExit` only calls `process.exit` itself when
				// the code is non-zero or a signal was received, so the success
				// branch then calls `process.exit` itself: code 0 cannot rely on the
				// event loop draining (see the comment in the branch).
				teardown: (exit, onExit) => {
					// `Runtime.Teardown`'s own signature is generic (`<E, A>(exit: Exit.Exit<E, A>, onExit: (code: number) =>
					// void) => void`), so inside this literal `exit.value` is typed abstractly as that generic `E`, not
					// concretely as `number` -- even though `program`'s success channel is `number` at every call site. The
					// cast is this well-known higher-order-generic-literal quirk, not a real type hole.
					if (Exit.isSuccess(exit)) {
						const code = exit.value as number;
						onExit(code);
						// The runner's `onExit` leaves a code-0 exit to the event loop draining. It never drains when the
						// client passed `--clientProcessId`: the library's node entry, loaded by `protocol/reference.ts`,
						// installs a never-unref'd liveness interval at module load. Exit explicitly, as LSP's `exit` requires.
						return process.exit(code);
					}
					if (Cause.hasInterruptsOnly(exit.cause)) return onExit(0);
					return Runtime.defaultTeardown(exit, onExit);
				},
			});
		},
	});
