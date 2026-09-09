import * as NodeServices from "@effect/platform-node/NodeServices";
import { AppDirs, Xdg } from "@effected/xdg";
import { Layer } from "effect";

/**
 * The XDG application namespace for every okfit program. The CLI and the
 * MCP server MUST resolve the same user-level config directory; a literal
 * at two call sites is exactly the drift this constant exists to prevent.
 *
 * @public
 */
export const OKFIT_APP_NAMESPACE = "okfit";

/**
 * K-9/K-11: `AppDirs.layer(options)` requires `Xdg | FileSystem | Path`,
 * so `Layer.provide(Xdg.layer)` alone does not close it.
 * `Layer.provideMerge(NodeServices.layer)` supplies `FileSystem`/`Path` to
 * both members and keeps every service in the output. `NodeServices.layer`
 * provides `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio |
 * Terminal`, a superset of `Command.Environment`.
 *
 * K-13: `Xdg.layer` fails with `XdgEnvError` when `HOME` is unset. Callers
 * are responsible for providing this layer INSIDE whatever region renders
 * their failures, so that error is rendered rather than escaping to a
 * fatal stack trace.
 *
 * @public
 */
export const OkfitPlatform = Layer.mergeAll(
	Xdg.layer,
	AppDirs.layer({ namespace: OKFIT_APP_NAMESPACE }).pipe(Layer.provide(Xdg.layer)),
).pipe(Layer.provideMerge(NodeServices.layer));
