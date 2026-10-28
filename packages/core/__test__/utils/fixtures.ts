// Reads static fixture trees with node:fs (allowed under __test__/, D-39) into
// @effected/memfs seeds; the code under test only sees FileSystem and Path (D-37).

import { join, resolve } from "node:path";
import type { MemoryFileSystemFaults, MemoryFileSystemSeed, MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { NodeDirectorySeed } from "@effected/memfs/node-sync";
import type { FileSystem } from "effect";
import { Effect, Layer, Path, PlatformError } from "effect";

/** The vendored upstream bundles (fixtures/okf/VENDORED.md). */
export const OKF_BUNDLES = ["acme_retail", "crypto_bitcoin", "ga4", "stackoverflow"] as const;
export type OkfBundleName = (typeof OKF_BUNDLES)[number];

/** The hand-written non-conformant bundles under fixtures/bad (D-40). */
export const BAD_BUNDLES = [
	"missing-type",
	"empty-type",
	"bare-verified",
	"legacy-timestamp",
	"offsetless-timestamp",
	"broken-link",
	"frontmatter-missing",
	"frontmatter-unclosed",
	"duplicate-key",
	"index-foreign-frontmatter",
	"log-non-date-heading",
	"footnote-unknown-source",
	"computation-runtime-missing",
	"hidden-directory",
] as const;
export type BadBundleName = (typeof BAD_BUNDLES)[number];

/** Absolute path of `packages/core/__test__/fixtures`. */
export const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");

const OKF_FIXTURES_DIR = join(FIXTURES_DIR, "okf");
const BAD_FIXTURES_DIR = join(FIXTURES_DIR, "bad");

/** Absolute posix mount points inside the virtual volume. */
export const OKF_MOUNT = "/repo/okf";
export const BAD_MOUNT = "/repo/bad";

/** Absolute mount point for suites that load one bundle as the whole volume root. */
export const MOUNT = "/repo/okf";

/** Every file and directory under `directory` (dotfiles included) as a seed keyed by `${mountAt}/${relative posix path}`. */
export const seedFromDirectory = (directory: string, mountAt: string): MemoryFileSystemSeed =>
	NodeDirectorySeed.read(directory, { mountAt });

export const okfBundleSeed = (name: OkfBundleName): MemoryFileSystemSeed =>
	seedFromDirectory(join(OKF_FIXTURES_DIR, name), `${OKF_MOUNT}/${name}`);

export const badBundleSeed = (name: BadBundleName): MemoryFileSystemSeed =>
	seedFromDirectory(join(BAD_FIXTURES_DIR, name), `${BAD_MOUNT}/${name}`);

/** memfs volume over `seed` plus Effect's posix `Path.layer`: the platform half of every suite. */
export const platform = (seed: MemoryFileSystemSeed): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

/** Bind the result to a `const` at module scope: each `Effect.provide` builds a fresh volume. */
export const okfBundlePlatform = (name: OkfBundleName): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(okfBundleSeed(name));

export const badBundlePlatform = (name: BadBundleName): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(badBundleSeed(name));

/** A vendored bundle mounted as the whole volume root at `MOUNT` (not under its own name). */
export const okfBundleAtRootPlatform = (name: OkfBundleName): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(seedFromDirectory(join(OKF_FIXTURES_DIR, name), MOUNT));

/** A non-conformant bundle mounted as the whole volume root at `MOUNT`. */
export const badBundleAtRootPlatform = (name: string): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	platform(seedFromDirectory(join(BAD_FIXTURES_DIR, name), MOUNT));

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
	return Layer.mergeAll(MemoryFileSystem.layerWith(full, { faults }), Path.layer);
};
