import { readFileSync } from "node:fs";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Layer, Path } from "effect";

/** The spec 4.2 example config, verbatim. */
export const specExampleToml: string = readFileSync(
	new URL("../fixtures/config/spec-example.toml", import.meta.url),
	"utf8",
);

/** memfs seeded with `files` plus the posix `Path` service (D-37). */
export const configPlatform = (files: MemoryFileSystemSeed): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(MemoryFileSystem.layerWith(files), Path.layer);
