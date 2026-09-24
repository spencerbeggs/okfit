/**
 * The assembled okfit MCP server program.
 *
 * @packageDocumentation
 */

import type { Distribution } from "@okfit/engine";

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

/**
 * Options `@okfit/plugin`'s `okfit-mcp` bin shim (and only it, today) passes
 * to {@link main}. `distribution` names the meta-package the server was
 * launched through; omitted for a direct install of `@okfit/mcp` (okfit
 * #137).
 *
 * @public
 */
export interface MainOptions {
	readonly distribution?: Distribution;
}

/**
 * Run the okfit MCP server over stdio. Owns the process.
 *
 * This module deliberately carries NO static imports of the server graph:
 * the `uncaughtException` and `unhandledRejection` handlers are registered
 * before `NodeRuntime`, `@effected/mcp` and `ServerLayer` are ever
 * evaluated, so a throw during module evaluation is still reported on
 * stderr rather than crashing silently. Adding a static import here would
 * defeat that -- `Distribution` above is a type-only import, so it carries
 * no runtime import at all. `@effected/mcp`'s `McpStdio.launch`/`teardown`
 * sits AROUND this requirement, not in place of it (design-patterns'
 * `carrier-entry-contract.md`).
 *
 * Assembled with `McpStdio.launch`/`McpStdio.teardown` (effect-v4-mcp's
 * `server-wiring.md`): `launch` reports a launch failure itself, on
 * stderr, before `NodeRuntime.runMain`'s own out-of-scope report could
 * print it to stdout -- the JSON-RPC wire; `teardown` maps stdin EOF (a
 * normal client disconnect) to exit `0` instead of the default `130`. Both
 * replace this module's own hand-rolled equivalents. `ServerLayer`'s stdio
 * server (`server.ts`) is built on `McpStdio.layer`, which already merges
 * `LogToStderr` into everything it provides, so this module no longer
 * assembles a logger itself either.
 *
 * @public
 */
export const main = async (options: MainOptions = {}): Promise<void> => {
	process.on("uncaughtException", (error) => fatal("uncaught exception", error));
	process.on("unhandledRejection", (reason) => fatal("unhandled rejection", reason));

	const { McpStdio } = await import("@effected/mcp");
	const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
	const { OkfitPlatform } = await import("@okfit/engine");
	const { Layer } = await import("effect");
	const { resolveMcpProjectRoot } = await import("./internal/projectRoot.js");
	const { ServerLayer } = await import("./server.js");

	const projectRoot = resolveMcpProjectRoot(process.env, process.cwd());

	const Main = ServerLayer(projectRoot, options).pipe(Layer.provide(OkfitPlatform));

	NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown });
};
