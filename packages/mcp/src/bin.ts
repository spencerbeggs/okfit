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
	const NodeServices = await import("@effect/platform-node/NodeServices");
	const { AppDirs, Xdg } = await import("@effected/xdg");
	const { Layer, Logger } = await import("effect");
	const { resolveMcpProjectRoot } = await import("./internal/projectRoot.js");
	const { ServerLayer } = await import("./server.js");

	const PlatformLayer = Layer.mergeAll(
		Xdg.layer,
		AppDirs.layer({ namespace: "okfit" }).pipe(Layer.provide(Xdg.layer)),
	).pipe(Layer.provideMerge(NodeServices.layer));

	const projectRoot = resolveMcpProjectRoot(process.env);

	const program = Layer.launch(
		ServerLayer(projectRoot).pipe(
			Layer.provide(PlatformLayer),
			Layer.provide(Logger.layer([Logger.consolePretty({ stderr: true })])),
		),
	);

	NodeRuntime.runMain(program);
})();
