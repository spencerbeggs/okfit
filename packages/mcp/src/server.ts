import { Git } from "@effected/git";
import type { AppDirs, Xdg } from "@effected/xdg";
import { GitHistory } from "@okfit/profiles";
import type { FileSystem, Path, Stdio } from "effect";
import { Layer } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ConceptResources } from "./resources/conceptResource.js";
import { IndexResource } from "./resources/indexResource.js";
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
 * `ChildProcessSpawner` is new (contract §10.3, S-16): `validate_bundle`'s
 * `Git`/`GitHistory` dependencies (`tools/validateBundle.ts`) are
 * discharged right here, below, by `Layer.mergeAll(Git.layer, GitHistory.layer)`
 * — both need only `ChildProcessSpawner` (`GitHistory.layer` itself provides
 * `Git.layer` internally, `packages/profiles/src/GitHistory.ts:136`), which
 * `bin.ts`'s untouched `PlatformLayer` already supplies via
 * `NodeServices.layer`. This type widening is the only thing that changes
 * at that boundary — `bin.ts` itself is not touched by this task.
 *
 * @public
 */
export type PlatformServices =
	| FileSystem.FileSystem
	| Path.Path
	| AppDirs
	| Xdg
	| Stdio.Stdio
	| ChildProcessSpawner.ChildProcessSpawner;

/**
 * The whole server as one layer: the toolkit, one static resource per
 * concept (`okf://concept/<id>`, built once at boot — see
 * {@link ConceptResources}), and `okf://index` (re-read from disk on every
 * call), over `McpServer.layerStdio`.
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
	Layer.mergeAll(
		McpServer.toolkit(OkfitToolkit).pipe(Layer.provideMerge(ToolsLayer(projectRoot))),
		ConceptResources(projectRoot),
		IndexResource(projectRoot),
	).pipe(
		// S-16, contract §10.3: `validate_bundle`'s widened `dependencies`
		// (Step 3) put `Git | GitHistory` into the toolkit layer's own
		// requirement channel above. `Layer.provide`, not `Layer.provideMerge`
		// — `ServerLayer`'s own success type stays `never`; nothing downstream
		// needs `Git`/`GitHistory` themselves, only the discharge.
		Layer.provide(Layer.mergeAll(Git.layer, GitHistory.layer)),
		Layer.provide(
			McpServer.layerStdio({
				name: "okfit",
				version: MCP_VERSION,
				protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
			}),
		),
		Layer.orDie,
	);
