import { ConfigIssueRenderer } from "@effected/cli";
import type { ConfigValidationError } from "@effected/config-file";
import { Runtime, Schema } from "effect";

/**
 * `--config <path>` named a path that does not exist. Every `ConfigResolver`
 * has a `never` error channel and `explicitPath` absorbs a missing target
 * into `Option.none()`, so a bad `--config` would otherwise fall through to
 * the XDG file silently. The CLI checks it itself before building any layer
 * (K-1, spec 4.1).
 *
 * @public
 */
export class ConfigPathNotFoundError extends Schema.TaggedError<ConfigPathNotFoundError>()("ConfigPathNotFoundError", {
	path: Schema.String,
}) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `config path not found: ${this.path}`;
	}
}

/**
 * `okfit init` found one or more of its target paths already present (K-28).
 * Carries the whole conflicting-path list so the renderer prints every one.
 * `paths` are absolute; `renderFailure` relativises them to `cwd` (K-51).
 *
 * @public
 */
export class InitOverwriteError extends Schema.TaggedError<InitOverwriteError>()("InitOverwriteError", {
	paths: Schema.Array(Schema.String),
	cwd: Schema.String,
}) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return "refusing to overwrite existing files";
	}
}

const hasTag = (error: unknown, tag: string): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && (error as { readonly _tag: unknown })._tag === tag;

/** `path` relative to `cwd` when it is under it, else the absolute path unchanged (K-51). */
const relativeToCwd = (path: string, cwd: string): string => {
	if (path === cwd) return ".";
	const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
	return path.startsWith(prefix) ? path.slice(prefix.length) : path;
};

/**
 * The `render` option for `CliRuntime.reportFailures` (K-30, K-46, K-51). One
 * string per stderr line; `reportFailures` emits each through its own
 * `Effect.logError`, which `CliLogger` routes to stderr.
 *
 * Rules, in order:
 *
 * 1. A `ShowHelp` (any `_tag === "ShowHelp"`) renders as `[]` — the empty
 *    array. `Command.runWith` has already rendered the help document and any
 *    parse errors before re-failing, so a second rendering here would print
 *    "Help requested" after the help text. This is why the K-30 remap in
 *    `bin.ts` can run ahead of `reportFailures` without corrupting `--help`
 *    output.
 * 2. `ConfigPathNotFoundError` renders as its own `error: <message>` line;
 *    `InitOverwriteError` renders as the K-51 header, one two-space-indented
 *    relativised path per conflict, and the literal `Nothing was written.`.
 * 3. A `ConfigValidationError` (detected by `_tag`, since the peer is
 *    optional and this module keeps it a type-only import) renders as
 *    `error: ${String(error)}` followed by one two-space-indented
 *    `ConfigIssueRenderer.render(error)` line per entry.
 * 4. Everything else — core's `BundleRootNotFoundError`/`BundleReadError`,
 *    config-file's other errors, `XdgEnvError` (the K-13 `HOME`-unset case)
 *    — renders as the single line `error: ${String(error)}`. Each of those
 *    classes' own `message` already names the offending path, which is all
 *    K-46 asserts.
 *
 * @public
 */
export const renderFailure = (error: unknown): ReadonlyArray<string> => {
	if (hasTag(error, "ShowHelp")) return [];
	if (error instanceof ConfigPathNotFoundError) return [`error: ${error.message}`];
	if (error instanceof InitOverwriteError) {
		return [
			"error: refusing to overwrite existing files:",
			...error.paths.map((path) => `  ${relativeToCwd(path, error.cwd)}`),
			"Nothing was written.",
		];
	}
	if (hasTag(error, "ConfigValidationError")) {
		const validationError = error as ConfigValidationError;
		return [
			`error: ${String(validationError)}`,
			...ConfigIssueRenderer.render(validationError).map((line) => `  ${line}`),
		];
	}
	return [`error: ${String(error)}`];
};
