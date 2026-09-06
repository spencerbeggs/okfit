import type { BundleLoadError, LoadedBundle, OkfitConfig, ValidationReport } from "@okfit/core";
import { Bundle, Validate } from "@okfit/core";
import type { Profile, ProfileDiagnostic } from "@okfit/profiles";
import type { DateTime, FileSystem, Path } from "effect";
import { Context, Effect, Option } from "effect";

/**
 * K-47's ambient clock. `bin.ts` resolves `OKFIT_NOW` (or the wall clock)
 * exactly once and provides it with `Effect.provideService(Now, value)`
 * around the whole command tree; `commands/validate.ts` and
 * `commands/init.ts` each read it with `const now = yield* Now;` before
 * building {@link RunOptions} or a scaffold's `today`. Not re-exported from
 * `index.ts`: like `internal/exit.ts` and `internal/tty.ts`, it means
 * nothing outside a spawned process (K-49). `Context.Tag` does not exist on
 * the Effect v4 line; the v4 shape is
 * `Context.Service<Self, Shape>()(id)`, the same form core and profiles use
 * for their own services (`PROFILES/GitHistory.ts:140`) — source wins over
 * the contract's literal snippet here (K-62).
 *
 * @internal
 */
export class Now extends Context.Service<Now, DateTime.Utc>()("@okfit/cli/Now") {}

/** @public */
export interface RunOptions {
	/** Absolute bundle root; `Bundle.load` never reads cwd (D-8). */
	readonly root: string;
	/** Already merged `DEFAULTS < profile < file` by the caller (D-28). */
	readonly config: OkfitConfig;
	/** The resolved profile, when `Profiles.get` found one. */
	readonly profile: Option.Option<Profile>;
	/** `OKFIT_NOW` or `DateTime.now`, from `bin.ts` (K-47); enables the `stale` rule (D-34). */
	readonly now: DateTime.Utc;
}

/** @public */
export interface RunResult {
	readonly bundle: LoadedBundle;
	readonly report: ValidationReport;
	/** `[]` when `profile` is `None`. */
	readonly profileDiagnostics: ReadonlyArray<ProfileDiagnostic>;
}

/**
 * Load, validate both tiers, run the profile check, collect. K-52 holds
 * structurally: `Bundle.load`'s failure short-circuits the generator, so
 * `profile.check` never runs on a bundle that did not load.
 *
 * @public
 */
export const run = (
	options: RunOptions,
): Effect.Effect<RunResult, BundleLoadError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.root });
		const report = Validate.all(bundle, options.config, { now: options.now });
		const profileDiagnostics = Option.match(options.profile, {
			onNone: (): ReadonlyArray<ProfileDiagnostic> => [],
			onSome: (profile) => profile.check(bundle),
		});
		return { bundle, report, profileDiagnostics };
	});
