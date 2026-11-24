import * as NodeServices from "@effect/platform-node/NodeServices";
import type { AppDirs as AppDirsType, Xdg as XdgType } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import type { FileSystem, Path } from "effect";
import { Layer } from "effect";

const HOME = "/nonexistent/home";

/**
 * The config-loading test environment: `Xdg.layerFrom` needs no filesystem and never reads `process.env`, and
 * `AppDirs.layer`'s own requirements are folded in with `provideMerge` over the live Node services.
 */
export const testEnv: Layer.Layer<AppDirsType | XdgType | FileSystem.FileSystem | Path.Path> = AppDirs.layer({
	namespace: "okfit",
}).pipe(
	Layer.provideMerge(
		Xdg.layerFrom(
			XdgPaths.make({
				home: HOME,
				configHome: `${HOME}/.config`,
				dataHome: `${HOME}/.local/share`,
				cacheHome: `${HOME}/.cache`,
				stateHome: `${HOME}/.local/state`,
				configDirs: [],
				dataDirs: [],
			}),
		),
	),
	Layer.provideMerge(NodeServices.layer),
);
