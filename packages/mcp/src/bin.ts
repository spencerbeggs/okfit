#!/usr/bin/env node

/**
 * MCP server entry point for okfit.
 *
 * @packageDocumentation
 */

const FATAL_FALLBACK = "okfit-mcp: a fatal error occurred and could not be described.";

const describe = (error: unknown): string => {
	try {
		if (error instanceof Error) return error.stack ?? error.message;
		return String(error);
	} catch {
		return FATAL_FALLBACK;
	}
};

const fatal = (label: string, error: unknown): never => {
	process.stderr.write(`okfit-mcp: ${label}: ${describe(error)}\n`);
	process.exit(1);
};

process.on("uncaughtException", (error) => fatal("uncaught exception", error));
process.on("unhandledRejection", (reason) => fatal("unhandled rejection", reason));

await (async () => {
	const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
	const { OkfitPlatform } = await import("@okfit/engine");
	const { Cause, Exit, Layer, Logger, Runtime } = await import("effect");
	const { resolveMcpProjectRoot } = await import("./internal/projectRoot.js");
	const { ServerLayer } = await import("./server.js");

	const projectRoot = resolveMcpProjectRoot(process.env);

	const program = Layer.launch(
		ServerLayer(projectRoot).pipe(
			Layer.provide(OkfitPlatform),
			Layer.provide(Logger.layer([Logger.consolePretty()])),
			// `Logger.consolePretty`'s own `stderr` option is inert in rc.112 --
			// the implementation only reads `{ colors, formatDate, mode }`
			// (internal/effect.ts:6454-6459) and silently drops it. The real
			// switch is this `LogToStderr` reference, read at log time
			// (internal/effect.ts:6488: `fiber.getRef(LogToStderr) ? console.error
			// : console.log`). Without it every log line lands on stdout, the
			// JSON-RPC wire (final whole-branch review, Critical finding 1).
			Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
		),
	);

	NodeRuntime.runMain(program, {
		// `defaultTeardown` (Runtime.ts:108-114) reports exit code 130 whenever
		// the main fiber's `Cause` contains only interruptions -- exactly what
		// a normal stdin-EOF shutdown produces, since nothing here treats
		// stdin closing as `Exit.succeed`. 130 conventionally means "killed by
		// SIGINT"; map it to 0 so a clean client disconnect does not read as a
		// crash in Claude Code's `/mcp` log. Any other failure keeps the
		// default behaviour. Verified against the installed
		// `@effect/platform-node@4.0.0-rc.112` `NodeRuntime.d.ts:54`'s
		// `teardown` option (review Minor finding 3).
		teardown: (exit, onExit) =>
			Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit),
	});
})();
