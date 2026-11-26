import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";

/** `arm` lets the swap run (call it after the bundle loaded); `fired` reports whether it ever did. */
export interface SwapTrap {
	readonly arm: () => void;
	readonly fired: () => boolean;
}

/**
 * memfs over `seed` whose `method` (`open`, or `lstat`) of `path`, once armed, runs `swap` on its first call and
 * answers `"before"` (the default) or `"after"` the swap. It triggers on the path and the method, never on a call
 * count, so it holds when the walker's own lstat pattern changes. `open` `"before"` lands the swap after the caller's
 * own check and before the confined read opens the file (the read then sees a link); `open` `"after"` lands it between
 * the open and the read's identity compare (the read holds the old file); `lstat` `"before"` lands it before the
 * first `lstat` of `path` after arming. Everything else delegates untouched.
 */
export const swapOn = (
	seed: MemoryFileSystemSeed,
	method: "open" | "lstat",
	path: string,
	swap: (fs: FileSystem.FileSystem) => Effect.Effect<void, unknown>,
	when: "before" | "after" = "before",
): readonly [Layer.Layer<FileSystem.FileSystem | Path.Path>, SwapTrap] => {
	let armed = false;
	let fired = false;
	const runSwap = (fs: FileSystem.FileSystem) =>
		Effect.suspend(() => {
			fired = true;
			return swap(fs).pipe(Effect.orDie);
		});
	const trap =
		<A extends ReadonlyArray<unknown>, B, E, R>(
			fs: FileSystem.FileSystem,
			read: (target: string, ...rest: A) => Effect.Effect<B, E, R>,
		) =>
		(target: string, ...rest: A) => {
			if (target !== path || !armed || fired) return read(target, ...rest);
			return when === "before"
				? runSwap(fs).pipe(Effect.andThen(read(target, ...rest)))
				: read(target, ...rest).pipe(Effect.tap(runSwap(fs)));
		};
	const wrapped = Layer.effect(FileSystem.FileSystem)(
		Effect.map(
			FileSystem.FileSystem,
			(fs): FileSystem.FileSystem =>
				method === "lstat" ? { ...fs, lstat: trap(fs, fs.lstat) } : { ...fs, open: trap(fs, fs.open) },
		),
	).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	return [Layer.mergeAll(wrapped, Path.layer), { arm: () => (armed = true), fired: () => fired }];
};
