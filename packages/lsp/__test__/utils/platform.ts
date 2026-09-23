import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Git } from "@effected/git";
import type { AppDirs as AppDirsType, Xdg as XdgType } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { GitHistory } from "@okfit/profiles";
import type { Crypto, FileSystem, Path } from "effect";
import { Layer } from "effect";
import type { SessionRegistryServices } from "../../src/session/registry.js";

/** Layers memoize by reference; bind these once per file rather than reconstructing them per call. */
const gitTest = Git.layerTest({});
const gitHistoryTest = GitHistory.layerTest({});

/**
 * `SessionRegistryServices` over fresh, per-call temp XDG directories,
 * mirroring `packages/engine/__test__/config/resolve.test.ts:19-34` exactly
 * so config discovery and `AppDirs` resolve the same way tests there do.
 *
 * @public
 */
export const testPlatform = (): Layer.Layer<SessionRegistryServices> => {
	const home = mkdtempSync(join(tmpdir(), "okfit-lsp-xdg-"));
	const testXdg: Layer.Layer<XdgType> = Xdg.layerFrom(
		XdgPaths.make({
			home,
			configHome: join(home, ".config"),
			dataHome: join(home, ".local", "share"),
			cacheHome: join(home, ".cache"),
			stateHome: join(home, ".local", "state"),
			configDirs: [],
			dataDirs: [],
		}),
	);

	const testEnv: Layer.Layer<AppDirsType | XdgType | FileSystem.FileSystem | Path.Path | Crypto.Crypto> = AppDirs.layer(
		{
			namespace: "okfit",
		},
	).pipe(Layer.provideMerge(testXdg), Layer.provideMerge(NodeServices.layer));

	return Layer.mergeAll(testEnv, gitTest, gitHistoryTest);
};
