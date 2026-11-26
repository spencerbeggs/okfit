import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";

/** A trap fired at most once; `fired` reports whether it ever ran, so a test can prove the swap really happened. */
export interface SwapTrap {
	readonly fired: () => boolean;
}

/**
 * memfs over `seed` whose `method` runs `swap` once, on the `nth` call (the first by default) for `path`, `"before"`
 * or `"after"` the call answers: before an `lstat` of the real path is the swap between a confined read's path
 * resolution and its identity compare; after the loader's own `lstat` is the swap between its link check and its
 * read. Everything else delegates untouched.
 */
export const swapPlatform = (
	seed: MemoryFileSystemSeed,
	method: "stat" | "lstat",
	when: "before" | "after",
	path: string,
	swap: (fs: FileSystem.FileSystem) => Effect.Effect<void, unknown>,
	nth = 1,
): readonly [Layer.Layer<FileSystem.FileSystem | Path.Path>, SwapTrap] => {
	let fired = false;
	let calls = 0;
	const once = (fs: FileSystem.FileSystem) =>
		Effect.suspend(() => {
			calls += 1;
			if (fired || calls < nth) return Effect.void;
			fired = true;
			return swap(fs).pipe(Effect.orDie);
		});
	const wrapped = Layer.effect(FileSystem.FileSystem)(
		Effect.map(FileSystem.FileSystem, (fs): FileSystem.FileSystem => {
			const trap =
				(read: FileSystem.FileSystem["stat"]): FileSystem.FileSystem["stat"] =>
				(target) =>
					target !== path
						? read(target)
						: when === "before"
							? once(fs).pipe(Effect.andThen(read(target)))
							: read(target).pipe(Effect.tap(once(fs)));
			return method === "stat" ? { ...fs, stat: trap(fs.stat) } : { ...fs, lstat: trap(fs.lstat) };
		}),
	).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	return [Layer.mergeAll(wrapped, Path.layer), { fired: () => fired }];
};
