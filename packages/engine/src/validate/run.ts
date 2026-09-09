import type { Git, GitCommandError, UnknownRefError } from "@effected/git";
import type { BundleLoadError, LoadedBundle, OkfitConfig, ValidationReport } from "@okfit/core";
import { Bundle, OkfitConfig as OkfitConfigNS, Validate } from "@okfit/core";
import type { GitHistory, GitHistoryError, Profile, ProfileDiagnostic } from "@okfit/profiles";
import { Provenance } from "@okfit/profiles";
import type { Crypto, DateTime, FileSystem, Path, PlatformError } from "effect";
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
export class Now extends Context.Service<Now, DateTime.Utc>()("@okfit/engine/Now") {}

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
	/**
	 * S-31: skip `Provenance.lint`'s git TIER (tier 2, the git-derived date
	 * comparison for concepts with no recorded `generated.body_sha256`)
	 * for this one invocation, without touching the project's `[lint]`
	 * table. `commands/validate.ts` threads `--skip-provenance` here; the
	 * PostToolUse hook passes the flag so an edit-time `validate` stays
	 * git-free even when the config leaves `generated-at-drift` at its
	 * default severity. Tier 1 (the pure, in-memory body-digest comparison)
	 * still runs regardless — that is exactly the signal edit time wants,
	 * at the cost of one sha256 over text already in memory. Defaults to
	 * `false`; `run` still gates the whole lint call on `severity ===
	 * "off"`, but no longer on this flag.
	 */
	readonly skipProvenance?: boolean;
}

/** @public */
export interface RunResult {
	readonly bundle: LoadedBundle;
	readonly report: ValidationReport;
	/** `[]` when `profile` is `None`. */
	readonly profileDiagnostics: ReadonlyArray<ProfileDiagnostic>;
}

/**
 * Load, validate both tiers, run the profile check, then — UNLESS the
 * `generated-at-drift` lint is `off` — run `Provenance.lint` and append its
 * `Diagnostic`s to `report.lint`. The "skip the whole lint" gate lives
 * HERE, in `run`: a bundle configured `off` never calls `Provenance.lint`
 * at all. `options.skipProvenance` is no longer that gate — it is threaded
 * through as `Provenance.lint`'s `skipGitTier` option instead, so tier 1
 * (the pure, in-memory `generated.body_sha256` comparison) still runs and
 * still reports drift even when `skipProvenance` is `true`; only tier 2
 * (the git-derived date comparison, for concepts with no recorded digest)
 * is skipped, and with it the only git spawn `Provenance.lint` can make
 * (S-31). An `error` severity on the appended diagnostics yields exit `1`
 * through the EXISTING lint-tier rule in `render/exit.ts` — no renderer
 * branch, no new `DiagnosticSource`, since these diagnostics flow through
 * the same `report.lint` array every other core lint diagnostic already
 * does.
 *
 * K-52 holds structurally: `Bundle.load`'s failure short-circuits the
 * generator, so `profile.check` never runs on a bundle that did not load.
 *
 * This is a BREAKING signature change: `@okfit/mcp`'s `validateBundle.ts`
 * calls this function directly and must be updated to match (Task C1);
 * `commands/validate.ts` is the other caller.
 *
 * @public
 */
export const run = (
	options: RunOptions,
): Effect.Effect<
	RunResult,
	BundleLoadError | GitHistoryError | GitCommandError | UnknownRefError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Git | GitHistory | Crypto.Crypto
> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.root });
		const report = Validate.all(bundle, options.config, { now: options.now });
		const profileDiagnostics = Option.match(options.profile, {
			onNone: (): ReadonlyArray<ProfileDiagnostic> => [],
			onSome: (profile) => profile.check(bundle),
		});
		const severity = OkfitConfigNS.severityFor(options.config, "generated-at-drift");
		const provenance =
			severity === "off"
				? []
				: yield* Provenance.lint(bundle, options.config, { skipGitTier: options.skipProvenance === true });
		return { bundle, report: { ...report, lint: [...report.lint, ...provenance] }, profileDiagnostics };
	});
