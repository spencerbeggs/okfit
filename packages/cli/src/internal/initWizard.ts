import { posix } from "node:path";
import type { Cancelled, CliTheme, NotInteractive } from "@effected/cli";
import { CliUi, Select, TextInput } from "@effected/cli/ui";
import { PROFILE_NAMES } from "@okfit/profiles";
import { Effect, Option, Runtime, Schema } from "effect";

/**
 * The three project-level config names `okfit` discovers (C-1), in the order
 * the wizard offers them; the first is the default (`CONFIG_RELATIVE_PATH`).
 *
 * @public
 */
export const INIT_CONFIG_LOCATIONS = [".config/okfit.toml", "okfit.toml", ".okfit.toml"] as const;

/** One of {@link INIT_CONFIG_LOCATIONS}. @public */
export type InitConfigLocation = (typeof INIT_CONFIG_LOCATIONS)[number];

/**
 * `okfit init --bundle <dir>` named a directory that is not a usable
 * project-relative path: empty, absolute, the project root itself, or
 * escaping it. A usage error (exit 64).
 *
 * @public
 */
export class InitBundleDirError extends Schema.TaggedError<InitBundleDirError>()("InitBundleDirError", {
	value: Schema.String,
	reason: Schema.String,
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return `invalid bundle directory "${this.value}": ${this.reason}`;
	}
}

/**
 * Validate and normalise a project-relative bundle directory. `Right`-like
 * result: the normalised directory (`./docs//kb/` becomes `docs/kb`), or the
 * reason it is unusable.
 */
export const checkBundleDir = (
	value: string,
): { readonly ok: true; readonly dir: string } | { readonly ok: false; readonly reason: string } => {
	const trimmed = value.trim();
	if (trimmed === "") return { ok: false, reason: "must not be empty" };
	if (posix.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
		return { ok: false, reason: "must be relative to the project root" };
	}
	const normal = posix.normalize(trimmed.replaceAll("\\", "/")).replace(/\/+$/, "");
	if (normal === "" || normal === ".") return { ok: false, reason: "must name a subdirectory of the project root" };
	if (normal === ".." || normal.startsWith("../")) return { ok: false, reason: "must not escape the project root" };
	return { ok: true, dir: normal };
};

/** Defaults the wizard offers, and answers with when a run is not interactive. */
export interface InitDefaults {
	readonly profile: string;
	readonly bundle: string;
	readonly location: InitConfigLocation;
}

/** Settings given as flags; a given setting is never prompted for. */
export interface InitGiven {
	readonly profile: Option.Option<string>;
	readonly bundle: Option.Option<string>;
	readonly location: Option.Option<InitConfigLocation>;
}

/**
 * The `okfit init` wizard: profile, bundle directory, config location, in
 * that order. A setting is prompted for only when its flag was not given and
 * the run is interactive (the profile also needs more than one registered: a
 * lone profile is used without a screen); otherwise its flag value or default is used
 * (`CliUi.prompt`'s `otherwise`, so a non-interactive run never loads Ink).
 *
 * A bad `--bundle` flag fails with {@link InitBundleDirError} before any
 * screen mounts. In the prompt, a bad entry is rejected inline by the text
 * input and the question stays open. Esc, `q` or Ctrl-C on any screen fails
 * with the kit's `Cancelled`; the caller performs every write only after this
 * returns, so a cancel writes nothing.
 *
 * Answered screens stay in scrollback (no `clear`): three short screens read
 * as a record of the answers, and erasing them leaves the terminal looking
 * as if nothing had been asked.
 */
export const initWizard = (
	given: InitGiven,
	defaults: InitDefaults,
): Effect.Effect<InitDefaults, Cancelled | NotInteractive | InitBundleDirError, CliTheme> =>
	Effect.gen(function* () {
		let flagBundle: string | undefined;
		if (Option.isSome(given.bundle)) {
			const checked = checkBundleDir(given.bundle.value);
			if (!checked.ok) return yield* new InitBundleDirError({ value: given.bundle.value, reason: checked.reason });
			flagBundle = checked.dir;
		}

		// One registered profile is not a question: a one-choice screen asks for
		// nothing, so the prompt is skipped and the default (the config's profile,
		// else the lone one) is used (#232).
		const profileNames: ReadonlyArray<string> = PROFILE_NAMES;
		const profile = Option.isSome(given.profile)
			? given.profile.value
			: profileNames.length === 1
				? defaults.profile
				: yield* CliUi.prompt(
						Select.screen({
							message: "Profile to scaffold with",
							choices: profileNames.map((name) => ({ label: name, value: name })),
							initial: Math.max(0, profileNames.indexOf(defaults.profile)),
						}),
						{ otherwise: defaults.profile },
					);

		const bundle =
			flagBundle ??
			(yield* CliUi.prompt(
				TextInput.screen({
					message: "Bundle directory (relative to the project root)",
					initial: defaults.bundle,
					validate: (entered) => {
						const checked = checkBundleDir(entered);
						return checked.ok ? undefined : checked.reason;
					},
				}),
				{ otherwise: defaults.bundle },
			).pipe(
				Effect.map((entered) => {
					const checked = checkBundleDir(entered);
					return checked.ok ? checked.dir : defaults.bundle;
				}),
			));

		const location = Option.isSome(given.location)
			? given.location.value
			: yield* CliUi.prompt(
					Select.screen({
						message: "Config file location",
						choices: INIT_CONFIG_LOCATIONS.map((name) => ({ label: name, value: name as InitConfigLocation })),
						initial: INIT_CONFIG_LOCATIONS.indexOf(defaults.location),
					}),
					{ otherwise: defaults.location },
				);

		return { profile, bundle, location };
	});
