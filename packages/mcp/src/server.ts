import { Git } from "@effected/git";
import { McpStdio, McpToolkit } from "@effected/mcp";
import type { AppDirs, Xdg } from "@effected/xdg";
import type { Distribution } from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import type { FileSystem, Path, Stdio } from "effect";
import { Layer } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ConceptResources } from "./resources/conceptResource.js";
import { IndexResource } from "./resources/indexResource.js";
import { OkfitToolkit, ToolsLayer } from "./toolkit.js";
import { MCP_VERSION } from "./version.js";

/**
 * Everything `ServerLayer` still needs from the platform: the four services
 * `describe_vocabulary`'s declared `Tool.make` dependencies pull through
 * `McpToolkit.layer`'s own `Tool.HandlerServices<Tools>` requirement, plus
 * `Stdio`, which `McpStdio.layer` itself requires and which the brief's own
 * `PlatformServices` literal omitted.
 *
 * `ChildProcessSpawner` is new (contract §10.3, S-16): `validate_bundle`'s
 * `Git`/`GitHistory` dependencies (`tools/validateBundle.ts`) are
 * discharged right here, below, by `Layer.mergeAll(Git.layer, GitHistory.layer)`
 * — both need only `ChildProcessSpawner` (`GitHistory.layer` itself provides
 * `Git.layer` internally, `packages/profiles/src/GitHistory.ts:136`), which
 * `@okfit/engine`'s `OkfitPlatform` already supplies via
 * `NodeServices.layer`. This type widening is the only thing that changes
 * at that boundary.
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
 * Options `ServerLayer` accepts, beyond `projectRoot`. `distribution`
 * (okfit #137) names the meta-package that launched this server (currently
 * only `@okfit/plugin`'s `okfit-mcp` bin shim), threaded down into
 * `validate_bundle`'s rendered `JsonEnvelope`; `undefined` for a direct
 * install of `@okfit/mcp`.
 *
 * @public
 */
export interface ServerOptions {
	readonly distribution?: Distribution;
}

/**
 * Agent-facing orientation, surfaced verbatim as `instructions` in both the
 * `initialize` result (2025-11-25 / 2025-06-18) and the `server/discover`
 * result (2026-07-28). `description` on the server identity stays the
 * one-line human summary; this is the paragraph an agent reads before its
 * first call. Exported so tests can assert identity rather than a
 * substring.
 *
 * @public
 */
export const SERVER_INSTRUCTIONS: string = [
	"okfit-mcp serves one Open Knowledge Format (OKF) bundle: the okf/ directory of the project it was launched in.",
	"Every tool is read-only and answers from the bundle as it is on disk at call time.",
	"Start with describe_vocabulary to learn the concept types and tags this project's config declares, then",
	"list_concepts to find ids; get_concept, concept_neighbors, stale_report and validate_bundle take those ids.",
	"Concept ids are bundle-relative paths without the .md extension (for example decisions/cli-exit-codes).",
	"Every successful tools/call result carries the typed payload in structuredContent and a JSON rendering in",
	"content[0].text. A failed call is isError: true with the human message and a remediation hint in",
	"content[0].text and no structuredContent; read that text before retrying.",
	"Resources: okf://index is the bundle's root index.md, and okf://concept/<id> is one static resource per concept.",
].join(" ");

/**
 * The whole server as one layer: the toolkit, one static resource per
 * concept (`okf://concept/<id>`, built once at boot — see
 * {@link ConceptResources}), and `okf://index` (re-read from disk on every
 * call), over `@effected/mcp`'s `McpStdio.layer`.
 *
 * `McpStdio.layer` (not core's own `McpServer.layerStdio`, hand-wired) is
 * load-bearing, not a style choice: it wraps core's stdin decoder with a
 * guard that answers a non-JSON line with a JSON-RPC `-32700` and keeps
 * serving, where hand-wiring `layerStdio` directly wedges permanently on
 * the first bad line (effect-v4-mcp's `server-wiring.md#stdin-guard`). It
 * also merges `LogToStderr` into everything it provides, so `main.ts` no
 * longer assembles a logger of its own. `McpToolkit.layer` (not core's
 * `McpServer.toolkit`) reports every unknown argument key a strict tool
 * call carries, at every depth, in one response, instead of only the
 * first.
 *
 * `protocols` ships three adapters, newest first -- the same list
 * `McpStdio.protocols` defaults to, spelled out here since the decision
 * behind the exact order is this package's own
 * (`okf/decisions/mcp-stateless-first-protocol-list.md`), not the kit's.
 * `McpProtocol.v2026_07_28` is the stateless adapter (SEP-2575): no
 * `initialize`, no session, every request self-identifies through
 * `params._meta`, and the client discovers the server with
 * `server/discover`. The two stateful adapters stay because `initialize`
 * matches stateful adapters only — a client that opens with `initialize`
 * (Claude Code by default, Copilot, Cursor, the Inspector) would otherwise
 * get `METHOD_NOT_FOUND`. Array order is load-bearing: a request with no
 * session and no `_meta` protocol version falls to `protocols[0]`, and
 * `server/discover` advertises every listed adapter in `supportedVersions`.
 * The runtime allows at most one stateless adapter; a second fails the
 * layer. Never reduce this to one entry.
 *
 * @public
 */
export const ServerLayer = (
	projectRoot: string,
	options: ServerOptions = {},
): Layer.Layer<never, never, PlatformServices> =>
	Layer.mergeAll(
		McpToolkit.layer(OkfitToolkit).pipe(Layer.provideMerge(ToolsLayer(projectRoot, options.distribution))),
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
			McpStdio.layer({
				name: "okfit",
				version: MCP_VERSION,
				instructions: SERVER_INSTRUCTIONS,
				protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
			}),
		),
	);
