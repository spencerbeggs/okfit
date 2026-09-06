import type { AppDirs, Xdg } from "@effected/xdg";
import type { FileSystem, Path, Stdio } from "effect";
import { Layer } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { OkfitToolkit, ToolsLayer } from "./toolkit.js";
import { MCP_VERSION } from "./version.js";

/**
 * Everything `ServerLayer` still needs from the platform: the four services
 * `describe_vocabulary`'s declared `Tool.make` dependencies pull through
 * `McpServer.toolkit`'s own `Tool.HandlerServices<Tools>` requirement, plus
 * `Stdio`, which `McpServer.layerStdio` itself requires
 * (`unstable/ai/McpServer.ts:1207-1216`) and which the brief's own
 * `PlatformServices` literal omitted.
 *
 * @public
 */
export type PlatformServices = FileSystem.FileSystem | Path.Path | AppDirs | Xdg | Stdio.Stdio;

/**
 * The whole server as one layer: the toolkit (and, from Task C4, the two
 * resources) over `McpServer.layerStdio`.
 *
 * `protocols` ships BOTH adapters, newest first (N-2). Array order is
 * load-bearing: the protocol registry falls back to `protocols[0]` for an
 * unrecognised client version, so a 2026-07-28 client is answered with
 * 2025-11-25. Never reduce this to one entry.
 *
 * `Cause.IllegalArgumentError` in `layerStdio`'s signature is left
 * unhandled: `protocols` is a static two-element literal, so it is an
 * implementer-time defect, not a runtime condition.
 *
 * @public
 */
export const ServerLayer = (projectRoot: string): Layer.Layer<never, never, PlatformServices> =>
	Layer.mergeAll(McpServer.toolkit(OkfitToolkit).pipe(Layer.provideMerge(ToolsLayer(projectRoot)))).pipe(
		Layer.provide(
			McpServer.layerStdio({
				name: "okfit",
				version: MCP_VERSION,
				protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
			}),
		),
		Layer.orDie,
	);
