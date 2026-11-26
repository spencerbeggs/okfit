import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";

/** `arm` lets the swap run (call it after the bundle loaded); `fired` reports whether it ever did. */
export interface SwapTrap {
	readonly arm: () => void;
	readonly fired: () => boolean;
}

/**
 * memfs over `seed` whose `lstat` of `path`, from its `nth` armed call (the first by default), first runs `swap` and then answers: the
 * swap lands between a confined read's path resolution and its identity compare (the read's own `lstat` of the real path). Everything else delegates untouched.
 */
export const swapOnLstat = (
	seed: MemoryFileSystemSeed,
	path: string,
	swap: (fs: FileSystem.FileSystem) => Effect.Effect<void, unknown>,
	nth = 1,
): readonly [Layer.Layer<FileSystem.FileSystem | Path.Path>, SwapTrap] => {
	let armed = false;
	let fired = false;
	let calls = 0;
	const wrapped = Layer.effect(FileSystem.FileSystem)(
		Effect.map(
			FileSystem.FileSystem,
			(fs): FileSystem.FileSystem => ({
				...fs,
				lstat: (target) =>
					target === path && armed && !fired && ++calls >= nth
						? Effect.suspend(() => {
								fired = true;
								return swap(fs).pipe(Effect.orDie);
							}).pipe(Effect.andThen(fs.lstat(target)))
						: fs.lstat(target),
			}),
		),
	).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	return [Layer.mergeAll(wrapped, Path.layer), { arm: () => (armed = true), fired: () => fired }];
};
