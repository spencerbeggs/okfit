import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";

/** `arm` lets the swap run (call it after the bundle loaded); `fired` reports whether it ever did. */
export interface SwapTrap {
	readonly arm: () => void;
	readonly fired: () => boolean;
}

/**
 * memfs over `seed` whose `method` (`open`, or `lstat`) of `path`, once armed and from its `nth` call (the first by
 * default), first runs `swap` and then answers. `open` lands the swap after the caller's own check and before the
 * confined read opens the file (the read then sees a link); `lstat` lands it between the read's path resolution and
 * its identity compare (the read's own `lstat` of the real path, the first one on `path`). Everything else
 * delegates untouched.
 */
export const swapOn = (
	seed: MemoryFileSystemSeed,
	method: "open" | "lstat",
	path: string,
	swap: (fs: FileSystem.FileSystem) => Effect.Effect<void, unknown>,
	nth = 1,
): readonly [Layer.Layer<FileSystem.FileSystem | Path.Path>, SwapTrap] => {
	let armed = false;
	let fired = false;
	let calls = 0;
	const due = (target: string) => target === path && armed && !fired && ++calls >= nth;
	const runSwap = (fs: FileSystem.FileSystem) =>
		Effect.suspend(() => {
			fired = true;
			return swap(fs).pipe(Effect.orDie);
		});
	const wrapped = Layer.effect(FileSystem.FileSystem)(
		Effect.map(
			FileSystem.FileSystem,
			(fs): FileSystem.FileSystem =>
				method === "lstat"
					? {
							...fs,
							lstat: (target) => (due(target) ? runSwap(fs).pipe(Effect.andThen(fs.lstat(target))) : fs.lstat(target)),
						}
					: {
							...fs,
							open: (target, options) =>
								due(target) ? runSwap(fs).pipe(Effect.andThen(fs.open(target, options))) : fs.open(target, options),
						},
		),
	).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	return [Layer.mergeAll(wrapped, Path.layer), { arm: () => (armed = true), fired: () => fired }];
};
