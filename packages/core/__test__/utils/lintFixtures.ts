import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Layer, Path } from "effect";

/** Absolute path of `packages/core/__test__/fixtures`. */
export const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");

/** Reads every file under `fixtures/<relativeDir>` into a memfs seed rooted at `mountAt` (absolute posix). */
export const seedFromDirectory = (relativeDir: string, mountAt: string): MemoryFileSystemSeed => {
	const root = join(FIXTURES_DIR, relativeDir);
	const seed: Record<string, string> = {};
	for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
		const absolute = join(root, entry);
		if (statSync(absolute).isFile()) {
			seed[`${mountAt}/${entry.split("\\").join("/")}`] = readFileSync(absolute, "utf8");
		}
	}
	return seed;
};

/** `FileSystem | Path` layer over one fixture directory (D-37). Bind the result to a `const` per fixture. */
export const platformFor = (relativeDir: string, mountAt: string): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(MemoryFileSystem.layerWith(seedFromDirectory(relativeDir, mountAt)), Path.layer);
