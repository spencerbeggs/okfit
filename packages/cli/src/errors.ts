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

/**
 * V-9: `<id>` did not resolve to a verifiable concept. `reason` is
 * `"not-a-concept"` (no such file, or an id that normalises to nothing),
 * `"reserved"` (the id names `index.md` or `log.md`), or `"undecodable"`
 * (a file exists but `bundle.diagnostics` names it — `diagnosticCode`
 * carries which). `root` is the absolute bundle root, kept OFF `message`
 * so K-51's relativisation rule has nothing to apply to and the human
 * line and the JSON envelope's `message` are identical.
 *
 * @public
 */
export class VerifyConceptNotFoundError extends Schema.TaggedError<VerifyConceptNotFoundError>()(
	"VerifyConceptNotFoundError",
	{
		id: Schema.String,
		root: Schema.String,
		reason: Schema.Literals(["not-a-concept", "reserved", "undecodable"]),
		diagnosticCode: Schema.optionalKey(Schema.String),
	},
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		const detail = this.diagnosticCode === undefined ? this.reason : `${this.reason}: ${this.diagnosticCode}`;
		return `no concept "${this.id}" in this bundle (${detail})`;
	}
}

/**
 * V-14: fail closed on a `verified` shape the classifier does not name.
 * `shape` is one of `"alias"`, `"merge-key"`, `"scalar"`, `"empty"` (and,
 * defensively, `"no-frontmatter"` or `"not-a-mapping"`, neither reachable
 * for a concept that reached `bundle.concepts`). The file is never opened
 * for writing when this is raised.
 *
 * @public
 */
export class VerifyUnsupportedFrontmatterError extends Schema.TaggedError<VerifyUnsupportedFrontmatterError>()(
	"VerifyUnsupportedFrontmatterError",
	{ id: Schema.String, shape: Schema.String },
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `"${this.id}"'s verified value is a shape okfit verify cannot edit (${this.shape}); edit it by hand`;
	}
}

const hasTag = (error: unknown, tag: string): boolean =>
	typeof error === "object" && error !== null && "_tag" in error && (error as { readonly _tag: unknown })._tag === tag;

/** The error's `message` when it has one as a string, else `String(error)`. */
const messageOf = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { readonly message: unknown }).message;
		if (typeof message === "string") return message;
	}
	return String(error);
};

/**
 * A config file at a KNOWN path failed to parse or validate (K-46's own
 * intent — "each class' message already names the offending path" does not
 * hold for `@effected/config-file`'s `ConfigCodecError`, which carries no
 * `path` field at all; this wraps it, and `ConfigValidationError`, with the
 * path the caller already knows). `cause` is the original config-file error,
 * preserved structurally, never stringified early.
 *
 * @public
 */
export class ConfigMalformedError extends Schema.TaggedError<ConfigMalformedError>()("ConfigMalformedError", {
	path: Schema.String,
	cause: Schema.Defect(),
}) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `malformed config ${this.path}: ${messageOf(this.cause)}`;
	}
}

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
