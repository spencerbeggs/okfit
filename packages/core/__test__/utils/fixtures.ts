// Reads static fixture trees with node:fs (allowed under __test__/, D-39) into
// @effected/memfs seeds; the code under test only sees FileSystem and Path (D-37).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Layer, Path } from "effect";

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

const OKF_FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures/okf");
const BAD_FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures/bad");

/** Absolute posix mount points inside the virtual volume. */
export const OKF_MOUNT = "/repo/okf";
export const BAD_MOUNT = "/repo/bad";

/** Every regular file under `directory` (dotfiles included) keyed by `${mountAt}/${relative posix path}`. */
export const seedFromDirectory = (directory: string, mountAt: string): MemoryFileSystemSeed => {
	const seed: Record<string, string> = {};
	const entries = readdirSync(directory, { recursive: true, encoding: "utf8" })
		.map((entry) => entry.replaceAll("\\", "/"))
		.sort();
	for (const relative of entries) {
		const absolute = join(directory, relative);
		if (!statSync(absolute).isFile()) continue;
		seed[`${mountAt}/${relative}`] = readFileSync(absolute, "utf8");
	}
	return seed;
};

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
