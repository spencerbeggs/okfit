import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MemoryFileSystemFaults, MemoryFileSystemSeed, MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Effect, Layer, Path, PlatformError } from "effect";

/** Absolute mount point; memfs resolves relative paths from its own root. */
export const MOUNT = "/repo/okf";
export const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");
export const OKF_BUNDLES = ["acme_retail", "crypto_bitcoin", "ga4", "stackoverflow"] as const;
export type OkfBundle = (typeof OKF_BUNDLES)[number];

/** Every file under `directory` as a memfs seed mounted at `mountAt` (posix keys). */
export const directorySeed = (directory: string, mountAt: string): MemoryFileSystemSeed => {
	const seed: Record<string, string> = {};
	for (const relative of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
		const absolute = join(directory, relative);
		if (!statSync(absolute).isFile()) continue;
		seed[`${mountAt}/${relative.split("\\").join("/")}`] = readFileSync(absolute, "utf8");
	}
	return seed;
};

/** `FileSystem` + posix `Path` over a seed (D-37). */
export const platform = (seed: MemoryFileSystemSeed): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

export const okfBundlePlatform = (name: OkfBundle): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(directorySeed(join(FIXTURES_DIR, "okf", name), MOUNT));

export const badBundlePlatform = (name: string): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(directorySeed(join(FIXTURES_DIR, "bad", name), MOUNT));

const denied = (method: string, path: string) =>
	Effect.fail(
		PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method, pathOrDescriptor: path }),
	);

/**
 * `platform` plus injected `PermissionDenied` failures: `readDirectory` on each absolute
 * directory in `unreadableDirs`, `readFileString` on each absolute file in `unreadableFiles`.
 */
export const faultyPlatform = (
	seed: MemoryFileSystemSeed,
	unreadableDirs: ReadonlySet<string>,
	unreadableFiles: ReadonlySet<string> = new Set(),
): Layer.Layer<FileSystem.FileSystem | Path.Path> => {
	const full: Record<string, MemoryFileSystemSeedEntry> = { ...seed };
	for (const dir of unreadableDirs) full[dir] ??= MemoryFileSystem.directory();
	const faults: MemoryFileSystemFaults = {
		readDirectory: (path) => (unreadableDirs.has(path) ? denied("readDirectory", path) : undefined),
		readFileString: (path) => (unreadableFiles.has(path) ? denied("readFileString", path) : undefined),
	};
	return Layer.mergeAll(MemoryFileSystem.layerFaultyWith(full, faults), Path.layer);
};
