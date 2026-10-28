import { join } from "node:path";
import type { FileSystem, Layer, Path } from "effect";
import { FIXTURES_DIR, platform, seedFromDirectory } from "./fixtures.js";

/** `FileSystem | Path` layer over one fixture directory (D-37). Bind the result to a `const` per fixture. */
export const platformFor = (relativeDir: string, mountAt: string): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(seedFromDirectory(join(FIXTURES_DIR, relativeDir), mountAt));
