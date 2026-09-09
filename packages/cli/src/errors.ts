import { ConfigIssueRenderer } from "@effected/cli";
import type { ConfigValidationError } from "@effected/config-file";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	InitOverwriteError,
	VerifyConceptNotFoundError,
	VerifyUnsupportedFrontmatterError,
} from "@okfit/engine";

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
 * 3. `ConfigMalformedError` renders as its own `error: <message>` line —
 *    `error: malformed config <path>: <cause message>` — since it already
 *    carries the offending path (`config/layer.ts#provideConfig` wraps a
 *    `ConfigCodecError`/`ConfigValidationError` into this the moment the
 *    path is known).
 * 4. A `ConfigValidationError` NOT already wrapped above (detected by
 *    `_tag`, since the peer is optional and this module keeps it a
 *    type-only import — this is the "path unknown" case, K-46) renders as
 *    `error: ${String(error)}` followed by one two-space-indented
 *    `ConfigIssueRenderer.render(error)` line per entry.
 * 5. `VerifyConceptNotFoundError` and `VerifyUnsupportedFrontmatterError`
 *    each render as their own `error: <message>` line; both messages
 *    already name the concept id and what to do about it, and neither
 *    carries a filesystem path needing K-51 relativisation.
 * 6. Everything else — core's `BundleRootNotFoundError`/`BundleReadError`/
 *    `BundleDepthExceededError`, config-file's other errors, `XdgEnvError`
 *    (the K-13 `HOME`-unset case) — renders as the single line
 *    `error: ${String(error)}`. Each of those
 *    classes' own `message` already names the offending path, which is all
 *    K-46 asserts.
 *
 * @public
 */
export const renderFailure = (error: unknown): ReadonlyArray<string> => {
	if (hasTag(error, "ShowHelp")) return [];
	if (error instanceof ConfigPathNotFoundError) return [`error: ${error.message}`];
	if (error instanceof ConfigMalformedError) return [`error: ${error.message}`];
	if (error instanceof InitOverwriteError) {
		return [
			"error: refusing to overwrite existing files:",
			...error.paths.map((path) => `  ${relativeToCwd(path, error.cwd)}`),
			"Nothing was written.",
		];
	}
	if (error instanceof VerifyConceptNotFoundError) return [`error: ${error.message}`];
	if (error instanceof VerifyUnsupportedFrontmatterError) return [`error: ${error.message}`];
	if (hasTag(error, "ConfigValidationError")) {
		const validationError = error as ConfigValidationError;
		return [
			`error: ${String(validationError)}`,
			...ConfigIssueRenderer.render(validationError).map((line) => `  ${line}`),
		];
	}
	return [`error: ${String(error)}`];
};
