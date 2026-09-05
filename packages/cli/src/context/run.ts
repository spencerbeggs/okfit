import { Effect, FileSystem, Path } from "effect";

/** @public */
export interface ContextRunOptions {
	readonly bundleRoot: string;
}

/** @public */
export interface ContextResult {
	readonly indexPath: string;
	readonly indexExists: boolean;
}

/**
 * The whole of `context`'s filesystem work: join `index.md` onto the bundle
 * root and stat it. Loading a bundle and running conformance/lint checks
 * over it never happen here — that is what makes `context` cheap enough
 * for a hook to run on every session start and every in-bundle write
 * (M-15).
 *
 * `"index.md"` is a literal here, not read from the profile's layout: the
 * spec fixes the reserved filename regardless of profile, and a
 * profile-less merge (`profile = "none"`) has no layout to read from at
 * all — `context` behaves identically with and without a profile.
 *
 * `exists` is `(path) => Effect.Effect<boolean, PlatformError>`, so an
 * unreadable parent directory would otherwise fail the command; here it is
 * absorbed to `false`, because "the hook could not stat index.md" and
 * "index.md is not there" are the same fact from a consumer's point of
 * view.
 *
 * @public
 */
export const runContext = (
	options: ContextRunOptions,
): Effect.Effect<ContextResult, never, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const indexPath = path.join(options.bundleRoot, "index.md");
		const indexExists = yield* fs.exists(indexPath).pipe(Effect.orElseSucceed(() => false));
		return { indexPath, indexExists };
	});
