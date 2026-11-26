import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";

/** A trap fired at most once; `fired` reports whether it ever ran, so a test can prove the swap really happened. */
export interface SwapTrap {
	readonly fired: () => boolean;
}

/**
 * memfs over `seed` whose `method` runs `swap` once, on the first call for `path`, `"before"` or `"after"` the call
 * answers. It triggers on the path and the method, never on a call count, so it holds when the walker's own stat
 * pattern changes. For a confined read of a file: `open` `"before"` is the swap between the loader's link check and the
 * open (the read opens whatever is there), `open` `"after"` the swap between the open and the identity compare (the
 * read holds the old file), and `lstat` `"before"` the swap before the read's `lstat` of the real path. Everything
 * else delegates untouched.
 */
export const swapPlatform = (
	seed: MemoryFileSystemSeed,
	method: "stat" | "lstat" | "open",
	when: "before" | "after",
	path: string,
	swap: (fs: FileSystem.FileSystem) => Effect.Effect<void, unknown>,
): readonly [Layer.Layer<FileSystem.FileSystem | Path.Path>, SwapTrap] => {
	let fired = false;
	const once = (fs: FileSystem.FileSystem) =>
		Effect.suspend(() => {
			if (fired) return Effect.void;
			fired = true;
			return swap(fs).pipe(Effect.orDie);
		});
	const trap =
		<A extends ReadonlyArray<unknown>, B, E, R>(
			fs: FileSystem.FileSystem,
			read: (target: string, ...rest: A) => Effect.Effect<B, E, R>,
		) =>
		(target: string, ...rest: A) =>
			target !== path
				? read(target, ...rest)
				: when === "before"
					? once(fs).pipe(Effect.andThen(read(target, ...rest)))
					: read(target, ...rest).pipe(Effect.tap(once(fs)));
	const wrapped = Layer.effect(FileSystem.FileSystem)(
		Effect.map(
			FileSystem.FileSystem,
			(fs): FileSystem.FileSystem =>
				method === "stat"
					? { ...fs, stat: trap(fs, fs.stat) }
					: method === "lstat"
						? { ...fs, lstat: trap(fs, fs.lstat) }
						: { ...fs, open: trap(fs, fs.open) },
		),
	).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	return [Layer.mergeAll(wrapped, Path.layer), { fired: () => fired }];
};

/** memfs over `seed` with `override(fs)` spread over it: one member answers differently, everything else delegates. */
export const overridePlatform = (
	seed: MemoryFileSystemSeed,
	override: (fs: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>,
): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(
		Layer.effect(FileSystem.FileSystem)(
			Effect.map(FileSystem.FileSystem, (fs): FileSystem.FileSystem => ({ ...fs, ...override(fs) })),
		).pipe(Layer.provide(MemoryFileSystem.layerWith(seed))),
		Path.layer,
	);
