import { OKF_SPEC_VERSION, OkfitConfig, OkfitConfigFile } from "@okfit/core";
import { Profiles } from "@okfit/profiles";
import { Console, DateTime, Effect, FileSystem, Option, Path } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { resolveBundleRoot, resolveProjectRoot } from "../config/anchor.js";
import { provideConfig } from "../config/layer.js";
import { InitOverwriteError } from "../errors.js";
import type { ScaffoldOptions } from "../init/scaffold.js";
import { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "../init/scaffold.js";
import { setExitCode } from "../internal/exit.js";
import { useColor } from "../internal/tty.js";
import { forDiagnostics } from "../render/exit.js";
import type { Counts } from "../render/human.js";
import { human, summary } from "../render/human.js";
import type { RenderedDiagnostic } from "../render/sort.js";
import { collect } from "../render/sort.js";
import { Now, run } from "../validate/run.js";

/**
 * `[path]` is the PROJECT root (K-2), never the bundle root — identical to
 * `validate`'s own argument (`Argument.path` resolves it absolute at the
 * parse boundary, satisfying K-50).
 */
const pathArg = Argument.path("path", { pathType: "directory" }).pipe(Argument.optional);

/** K-1: no `mustExist` — existence is checked by `provideConfig`, identical to `validate`'s flag. */
const configFlag = Flag.file("config").pipe(Flag.optional);

/**
 * K-3: `Flag.string`, deliberately not `Flag.choice` against
 * `PROFILE_NAMES` (`PROFILES/Profile.ts:10`) — an unrecognised name is a
 * CLI-rendered warning (K-4), matching `Profiles.get`'s own `Option.none`
 * contract (P-38), not a parser-level `CliError.InvalidValue`.
 */
const profileFlag = Flag.string("profile").pipe(Flag.optional);

/**
 * Stands in for `profile.config` when `Profiles.get` returns `None`.
 * `OkfitConfig.merge` only visits `Object.keys(override)`
 * (`CORE/OkfitConfig.ts:229-245`), so merging this in leaves every other key
 * at the base's value — it exists only to satisfy `merge`'s signature.
 */
const NO_PROFILE_CONFIG: OkfitConfig = { extensions: {} };

/**
 * `bundle` and `bundle.profile`/`bundle.path` are all `optionalKey` in the
 * schema (`CORE/OkfitConfig.ts`), so the type checker sees `string |
 * undefined` two levels deep even though `OkfitConfig.DEFAULTS` always sets
 * both at runtime — the same `??` fallback `commands/validate.ts`'s own
 * `DEFAULT_PROFILE_NAME` uses.
 */
const DEFAULT_PROFILE_NAME: string = OkfitConfig.DEFAULTS.bundle?.profile ?? "software-project";

/** See {@link DEFAULT_PROFILE_NAME}. */
const DEFAULT_BUNDLE_PATH: string = OkfitConfig.DEFAULTS.bundle?.path ?? "okf";

/** K-51: relative to cwd when under it, else absolute — the rule `render/human.ts`'s `summary` caller applies to `root`. */
const displayPath = (path: Path.Path, cwd: string, target: string): string => {
	const relative = path.relative(cwd, target);
	return relative.startsWith("..") ? target : relative;
};

const countsOf = (diagnostics: ReadonlyArray<RenderedDiagnostic>, concepts: number): Counts => ({
	errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
	warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
	info: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
	concepts,
});

/**
 * `okfit init [path] [--profile <name>] [--config <file>]` (K-2, K-3; no
 * `--format`, human output only, K-6).
 *
 * Handler order, fixed by the contract:
 *
 *  1. `cwd = process.cwd()`; `discoveryCwd = Option.getOrElse(path, () => cwd)`.
 *  2. `provideConfig({ explicitConfigPath: config, discoveryCwd })` wraps
 *     everything from step 3 on, identical to `validate`'s own pre-flight
 *     (K-57).
 *  3. `sources = yield* (yield* OkfitConfigFile).discover`; the winner is
 *     `sources[0]`.
 *  4. `profileName = Option.getOrElse(input.profile, () =>
 *     fileConfig.bundle?.profile ?? DEFAULTS.bundle.profile)` (K-3, the one
 *     difference from `validate`'s step 4). `Profiles.get(profileName)`.
 *     `None` and `profileName !== "none"` warns (K-4); `"none"` is silent.
 *  5. `merged = OkfitConfig.merge(OkfitConfig.merge(DEFAULTS, profileConfig),
 *     fileConfig)`, `profileConfig` falling back to `NO_PROFILE_CONFIG` when
 *     no profile resolved.
 *  6. `merged.okf_version !== OKF_SPEC_VERSION` warns (K-15).
 *  7. `projectRoot`/`bundleRoot` via `config/anchor.ts`; `now = yield* Now`;
 *     `layout` falls back to `Profiles.softwareProject.layout` when no
 *     profile resolved (this file's own decision 2 above — `Layout` has no
 *     `DEFAULTS` equivalent).
 *  8. `paths = targetPaths(...)`; every path stat-ed; ANY existing fails
 *     with `InitOverwriteError` before a single byte is written (K-28).
 *  9. `mkdir -p` every target's parent, THEN write `configValue(...)`
 *     through `OkfitConfigFile.write` and every `files(...)` entry through
 *     `fs.writeFileString` — `OkfitConfigFile.write` deliberately does not
 *     create its parent (`CF/index.d.ts:517-521`), and `save` is unusable
 *     here since it targets the XDG `defaultPath`, which K-14 forbids.
 * 10. `Console.log` the K-51 success line.
 * 11. self-validate (K-29): `run({ root: bundleRoot, config: merged,
 *     profile, now })` over the bundle just written, rendered exactly as
 *     `validate --format human` does, `setExitCode` to its
 *     `forDiagnostics` result. The handler SUCCEEDS (K-7); the failure path
 *     is only `InitOverwriteError` at step 8, or an infrastructure error
 *     that already carries its own `[Runtime.errorExitCode]`.
 *
 * @public
 */
export const initCommand = Command.make("init", { path: pathArg, config: configFlag, profile: profileFlag }, (input) =>
	Effect.gen(function* () {
		const cwd = process.cwd();
		const discoveryCwd = Option.getOrElse(input.path, () => cwd);

		yield* provideConfig({ explicitConfigPath: input.config, discoveryCwd })(
			Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				const sources = yield* configFile.discover;
				const winner = sources[0];
				const fileConfig: OkfitConfig = winner === undefined ? { extensions: {} } : winner.value;

				const profileName = Option.getOrElse(input.profile, () => fileConfig.bundle?.profile ?? DEFAULT_PROFILE_NAME);
				const profile = Profiles.get(profileName);
				if (Option.isNone(profile) && profileName !== "none") {
					yield* Console.error(`warning: unknown profile "${profileName}"; continuing with defaults`);
				}

				const profileConfig = Option.match(profile, {
					onNone: () => NO_PROFILE_CONFIG,
					onSome: (resolved) => resolved.config,
				});
				const merged = OkfitConfig.merge(OkfitConfig.merge(OkfitConfig.DEFAULTS, profileConfig), fileConfig);

				if (merged.okf_version !== OKF_SPEC_VERSION) {
					yield* Console.error(
						`warning: okf_version "${merged.okf_version}" does not match this okfit's spec version "${OKF_SPEC_VERSION}"; continuing`,
					);
				}

				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;

				const projectRoot = resolveProjectRoot({
					pathArg: input.path,
					explicitConfigPath: input.config,
					discovered:
						winner === undefined ? Option.none() : Option.some({ path: winner.path, resolver: winner.resolver }),
					cwd,
					path,
				});
				const bundleRoot = resolveBundleRoot(projectRoot, merged, path);
				const now = yield* Now;

				const layout = Option.match(profile, {
					onNone: () => Profiles.softwareProject.layout,
					onSome: (resolved) => resolved.layout,
				});

				const scaffoldOptions: ScaffoldOptions = {
					projectRoot,
					bundleRoot,
					layout,
					profileName,
					projectTitle: path.basename(projectRoot),
					today: DateTime.formatIso(now).slice(0, 10),
				};

				const paths = targetPaths(scaffoldOptions);
				const existing: Array<string> = [];
				for (const target of paths) {
					if (yield* fs.exists(target)) {
						existing.push(target);
					}
				}
				if (existing.length > 0) {
					return yield* new InitOverwriteError({ paths: existing, cwd });
				}

				for (const target of paths) {
					yield* fs.makeDirectory(path.dirname(target), { recursive: true });
				}

				const bundlePath = merged.bundle?.path ?? DEFAULT_BUNDLE_PATH;
				yield* configFile.write(
					configValue({ ...scaffoldOptions, bundlePath }),
					`${projectRoot}/${CONFIG_RELATIVE_PATH}`,
				);

				const scaffoldFiles = yield* files(scaffoldOptions);
				for (const file of scaffoldFiles) {
					yield* fs.writeFileString(file.path, file.contents);
				}

				yield* Console.log(`Initialized ${displayPath(path, cwd, bundleRoot)} with the ${profileName} profile`);

				const result = yield* run({ root: bundleRoot, config: merged, profile, now });
				const diagnostics = collect(result.report.conformance, result.report.lint, result.profileDiagnostics);
				for (const line of human(diagnostics, { color: useColor() })) {
					yield* Console.log(line);
				}
				yield* Console.error(
					summary(countsOf(diagnostics, result.bundle.concepts.size), displayPath(path, cwd, bundleRoot)),
				);
				setExitCode(forDiagnostics(diagnostics));
			}),
		);
	}),
).pipe(
	Command.withDescription(
		"Scaffold a new OKF bundle: a config file, the bundle's root and per-directory index files, a project stub, and an initial log entry.",
	),
);
