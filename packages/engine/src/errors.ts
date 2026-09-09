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
