import type { FailureDetails } from "@effected/cli";
import { ConfigIssueRenderer } from "@effected/cli";
import type { ConfigValidationError } from "@effected/config-file";
import {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	DocumentPathError,
	InitOverwriteError,
	NotAPublicationError,
	PublicationNotFoundError,
	QueryConceptNotFoundError,
	QuerySelectionError,
	QueryUnknownVocabularyError,
	SyncPublicationConflictError,
	SyncStagedLogError,
	VerifyConceptNotFoundError,
	VerifySelectionError,
	VerifyUnsupportedFrontmatterError,
} from "@okfit/engine";
import { InitBundleDirError } from "./internal/initWizard.js";
import { DocumentStdinIsTerminalError } from "./internal/stdin.js";

const hasTag = (error: unknown, tag: string): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && (error as { readonly _tag: unknown })._tag === tag;

/** Where a defect's report sends the reader. */
const ISSUE_URL = "https://github.com/spencerbeggs/okfit/issues";

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
 * 1. A cancelled or non-interactive run (`details.isCancelled`,
 *    `details.isNotInteractive`: a cancelled fallback prompt is a defect in the
 *    cause, but not a bug) renders as the kit's own `defaultLines`, unprefixed.
 *    `ShowHelp` never reaches `render`: `CliRuntime.main` handles it first.
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
 * 4a. `InitBundleDirError` (`okfit init --bundle`, exit 64) renders as one
 *    `error: <message>` line.
 * 5. `VerifyConceptNotFoundError` and `VerifyUnsupportedFrontmatterError`
 *    each render as their own `error: <message>` line; both messages
 *    already name the concept id and what to do about it, and neither
 *    carries a filesystem path needing K-51 relativisation.
 * 5a. `SyncStagedLogError` (issue #140) renders the same way, one
 *    `error: <message>` line naming why `--staged` and `--only log` cannot
 *    combine.
 * 5b. `VerifySelectionError` (issue #138) renders the same way, one
 *    `error: <message>` line naming why `okfit verify`'s selection was
 *    contradictory, empty, or named an undeclared type.
 * 5c. `DocumentPathError` and `DocumentStdinIsTerminalError` (`--document`)
 *    each render as one `error: <message>` line.
 * 5d. `QueryUnknownVocabularyError`, `QueryConceptNotFoundError` and
 *    `QuerySelectionError` (`okfit query`) each render as one
 *    `error: <message>` line.
 * 6. A defect (`details.isDefect`: a `die`, a thrown exception, a bug) that no
 *    rule above claimed renders as `error: ` plus the kit's report for the
 *    run without its status marker, then `Please report at <issues URL>`.
 * 7. Every other typed failure — core's `BundleRootNotFoundError`/`BundleReadError`/
 *    `BundleDepthExceededError`, config-file's other errors, `XdgEnvError`
 *    (the K-13 `HOME`-unset case) — renders as the single line
 *    `error: ${String(error)}`. Each of those
 *    classes' own `message` already names the offending path, which is all
 *    K-46 asserts.
 *
 * `details` is the kit's `FailureDetails`: `isDefect` tells a typed failure
 * from a defect exactly, so no rule here guesses from an error's shape.
 *
 * @public
 */
export const renderFailure = (error: unknown, details: FailureDetails): ReadonlyArray<string> => {
	// #217: the kit's own fixed line. Neither gets an `error:` prefix: a person
	// backing out is not an error (exit 130). The flags hold on either channel.
	if (details.isCancelled || details.isNotInteractive) return details.defaultLines;
	if (error instanceof ConfigPathNotFoundError) return [`error: ${error.message}`];
	if (error instanceof ConfigMalformedError) return [`error: ${error.message}`];
	if (error instanceof InitOverwriteError) {
		return [
			"error: refusing to overwrite existing files:",
			...error.paths.map((path) => `  ${relativeToCwd(path, error.cwd)}`),
			"Nothing was written.",
		];
	}
	if (error instanceof InitBundleDirError) return [`error: ${error.message}`];
	if (error instanceof VerifyConceptNotFoundError) return [`error: ${error.message}`];
	if (error instanceof VerifyUnsupportedFrontmatterError) return [`error: ${error.message}`];
	if (error instanceof SyncStagedLogError) return [`error: ${error.message}`];
	if (error instanceof SyncPublicationConflictError) return [`error: ${error.message}`];
	// `sync --publication`: an unknown id or a non-Publication gets the list hint; a
	// renders entry that points nowhere is a fix-the-entry error and needs none.
	if (error instanceof PublicationNotFoundError) {
		return error.publication === undefined
			? [`error: ${error.message}`, "hint: run okfit query --type Publication to list publication ids"]
			: [`error: ${error.message}`];
	}
	if (error instanceof NotAPublicationError) {
		return [`error: ${error.message}`, "hint: run okfit query --type Publication to list publication ids"];
	}
	if (error instanceof VerifySelectionError) return [`error: ${error.message}`];
	if (error instanceof QueryUnknownVocabularyError) return [`error: ${error.message}`];
	if (error instanceof QueryConceptNotFoundError) return [`error: ${error.message}`];
	if (error instanceof QuerySelectionError) return [`error: ${error.message}`];
	if (error instanceof DocumentPathError) return [`error: ${error.message}`];
	if (error instanceof DocumentStdinIsTerminalError) return [`error: ${error.message}`];
	if (hasTag(error, "ConfigValidationError")) {
		const validationError = error as ConfigValidationError;
		return [
			`error: ${String(validationError)}`,
			...ConfigIssueRenderer.render(validationError).map((line) => `  ${line}`),
		];
	}
	// A defect is a bug in okfit, not a condition the caller caused: the kit's
	// report for this run (message plus the program's own stack frames, in the
	// run's colour and `displayPath`), its status marker replaced by our
	// prefix, then where to report it. A typed failure is the one line.
	if (details.isDefect) {
		const [first = String(error), ...rest] = details.lines({ status: false });
		return [`error: ${first}`, ...rest, `Please report at ${ISSUE_URL}`];
	}
	return [`error: ${String(error)}`];
};
