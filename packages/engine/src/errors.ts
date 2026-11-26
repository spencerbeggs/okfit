import { INTEGRITY_KEY } from "@okfit/core";
import { Runtime, Schema } from "effect";
import { describeConfigCause } from "./config/issues.js";
import { LEGACY_INTEGRITY_KEY } from "./sync/legacyKeys.js";

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
 * V-14: fail closed on a `verified` (or, under `--stable`/`--draft`, `status`)
 * shape the classifier does not name; `key` says which, omitted meaning `verified`.
 * `shape` is one of `"alias"`, `"merge-key"`, `"scalar"`, `"empty"` (and,
 * defensively, `"no-frontmatter"` or `"not-a-mapping"`, neither reachable
 * for a concept that reached `bundle.concepts`). The file is never opened
 * for writing when this is raised.
 *
 * @public
 */
export class VerifyUnsupportedFrontmatterError extends Schema.TaggedError<VerifyUnsupportedFrontmatterError>()(
	"VerifyUnsupportedFrontmatterError",
	{
		id: Schema.String,
		shape: Schema.String,
		key: Schema.optionalKey(Schema.Literals(["verified", "status", "stale_after", INTEGRITY_KEY])),
	},
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		if (this.shape === "legacy-key") {
			return `"${this.id}" still carries okfit's old \`${LEGACY_INTEGRITY_KEY}\` block; run okfit sync to rename it to \`${INTEGRITY_KEY}\`, then verify again`;
		}
		return `"${this.id}"'s ${this.key ?? "verified"} value is a shape okfit verify cannot edit (${this.shape}); edit it by hand`;
	}
}

/**
 * `okfit verify` cannot bind a verification to a concept whose content cannot be
 * hashed: a frontmatter value holds an unpaired surrogate (a YAML `"\\uD800"`
 * escape), which the content digest's canonical JSON refuses (okfit#327). Nothing
 * was written. Exit 3, like the other verify refusals.
 *
 * @public
 */
export class VerifyContentUnhashableError extends Schema.TaggedError<VerifyContentUnhashableError>()(
	"VerifyContentUnhashableError",
	{
		id: Schema.String,
		path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
		detail: Schema.String,
	},
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		const where = this.path.length === 0 ? "its frontmatter" : this.path.join(".");
		return `"${this.id}" cannot be verified: ${where} cannot be hashed (${this.detail}); fix the value, then re-run okfit verify`;
	}
}

/**
 * OKF 0.3 §5.4: a `status` outside `draft | stable | deprecated` is not stable, so `okfit verify`
 * refuses to attest the concept. `status` is the value as written (`Derive.rawStatus`, so `5` reads
 * `"5"`). Passing `--stable` or `--draft` is the fix, because that write replaces the status. Exit 3,
 * like the other verify refusals.
 *
 * @public
 */
export class VerifyStatusUnknownError extends Schema.TaggedError<VerifyStatusUnknownError>()(
	"VerifyStatusUnknownError",
	{ id: Schema.String, status: Schema.String },
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `"${this.id}" has status "${this.status}", which is not draft, stable or deprecated; fix the status (or pass --stable or --draft) before verifying`;
	}
}

/**
 * OKF 0.3 §5.3: a verification made before the concept's last change (`generated.at`) does not count, so
 * `okfit verify` refuses to write one, whether `at` came from `--at` or the clock is behind a `generated.at`
 * in the future (ruling R33). `at` and `generatedAt` are the encoded instants. `kind` says how the stamp relates
 * to now when now is known: `"blocked"` (more than the tolerance later, and a verification dated between now and the
 * stamp, `blockedBy`, would start to count if sync re-stamped it, so sync skips it and a human must correct the stamp
 * or that verification), `"future"` (more than the tolerance later, which `okfit sync` re-stamps) or
 * `"near-future"` (later, but within the tolerance, so only the clock or waiting helps); absent when `generatedAt`
 * is not later than now, so only the verification time is to blame (verify at or after it, or omit `--at`).
 * Exit 3, like the other verify refusals. A batch, an id list and the pickers skip such a concept instead of failing.
 *
 * @public
 */
export class VerifyNotCurrentError extends Schema.TaggedError<VerifyNotCurrentError>()("VerifyNotCurrentError", {
	id: Schema.String,
	at: Schema.String,
	generatedAt: Schema.String,
	kind: Schema.optionalKey(Schema.Literals(["blocked", "future", "near-future"])),
	blockedBy: Schema.optionalKey(Schema.String),
}) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		switch (this.kind) {
			case "blocked":
				return `"${this.id}" has generated.at ${this.generatedAt}, which is later than now, so no verification made now would count (OKF 0.3 §5.3). okfit sync will not re-stamp it, because the verification dated ${this.blockedBy} would then count without a re-verification; a human must correct generated.at or that verification`;
			case "future":
				return `"${this.id}" has generated.at ${this.generatedAt}, which is later than now, so no verification made now would count (OKF 0.3 §5.3). Run okfit sync, which re-stamps a generated.at more than 5 minutes later than now, then verify again`;
			case "near-future":
				return `"${this.id}" has generated.at ${this.generatedAt}, which is later than now by less than 5 minutes, so no verification made now would count yet (OKF 0.3 §5.3). Check the clock, or verify again at or after ${this.generatedAt}`;
			default:
				return `"${this.id}" was last changed at ${this.generatedAt}, after the verification time ${this.at}; a verification before the last change does not count (OKF 0.3 §5.3). Verify at or after ${this.generatedAt}, or omit --at to verify now`;
		}
	}
}

/**
 * `okfit verify --revoke` found no `verified` entry by the resolved actor on
 * the concept, so there is nothing to remove. Exit 3, like any other verify
 * outcome that cannot proceed on the concept.
 *
 * @public
 */
export class VerifyNothingToRevokeError extends Schema.TaggedError<VerifyNothingToRevokeError>()(
	"VerifyNothingToRevokeError",
	{ id: Schema.String, actor: Schema.String },
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `"${this.id}" has no verified entry by ${this.actor} to revoke`;
	}
}

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
		return `malformed config ${this.path}: ${describeConfigCause(this.cause)}`;
	}
}

/**
 * `applySyncPlan` found a file its plan would write changed since `planSync`
 * read it, so applying the plan would overwrite an edit the plan never showed.
 * Nothing was written. `paths` are the changed targets (absolute); re-run sync.
 *
 * @public
 */
export class SyncPlanStaleError extends Schema.TaggedError<SyncPlanStaleError>()("SyncPlanStaleError", {
	paths: Schema.Array(Schema.String),
}) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		return `changed since the sync plan was made: ${this.paths.join(", ")}; nothing was written, re-run sync`;
	}
}

/**
 * `okfit sync --publication` runs nothing else, so combining it with a mode
 * or selection flag (`--only`, `--staged`, `--since`) is a usage error. Exit 64.
 *
 * @public
 */
export class SyncPublicationConflictError extends Schema.TaggedError<SyncPublicationConflictError>()(
	"SyncPublicationConflictError",
	{ flags: Schema.Array(Schema.String) },
) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return `--publication restamps one Publication and runs nothing else; it cannot combine with ${this.flags.join(", ")}`;
	}
}

/**
 * Issue #138: `okfit verify`'s selection was contradictory or empty. Exit 64: a usage error.
 *
 * `at-future` is an `--at` more than 5 minutes later than now (#503) and `at-malformed` an `--at` that is not a
 * timestamp (#513); for both, `detail` is the value. `at-malformed` quotes it in double quotes exactly as given (so an empty value reads `""`), and a front end that
 * prints it to a terminal puts it on one line itself.
 *
 * @public
 */
export class VerifySelectionError extends Schema.TaggedError<VerifySelectionError>()("VerifySelectionError", {
	reason: Schema.Literals([
		"no-selection",
		"targets-and-batch",
		"unknown-type",
		"status-conflict",
		"status-and-batch",
		"dry-run-needs-verify",
		"revoke-needs-id",
		"revoke-conflict",
		"at-future",
		"at-malformed",
	]),
	detail: Schema.optionalKey(Schema.String),
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		if (this.reason === "no-selection")
			return "verify needs a concept id, --all, or --type <Type> (run in a terminal to pick interactively)";
		if (this.reason === "targets-and-batch") return "verify takes concept targets or --all/--type, not both";
		if (this.reason === "revoke-needs-id") return "--revoke needs at least one concept target";
		if (this.reason === "revoke-conflict") {
			return `--revoke removes your own verification of the named concepts; it cannot combine with ${this.detail ?? "other selectors"}`;
		}
		if (this.reason === "at-future") {
			return `--at ${this.detail ?? ""} is more than 5 minutes later than now; a verification records when the review happened, so give a time no later than now, or omit --at to record now`;
		}
		if (this.reason === "at-malformed") {
			return `--at "${this.detail ?? ""}" is not a timestamp; give an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm), such as 2026-11-25T12:00:00Z, or a date (YYYY-MM-DD, read as midnight UTC)`;
		}
		if (this.reason === "status-conflict") return "verify takes --stable or --draft, not both";
		if (this.reason === "dry-run-needs-verify") return "--dry-run needs --verify; bare okfit stale writes nothing";
		if (this.reason === "status-and-batch") {
			return "--stable and --draft need exactly one concept target; batch mode never changes status";
		}
		return `type "${this.detail ?? ""}" is not declared in the config`;
	}
}

const DOCUMENT_PATH_REASON_TEXT = {
	"not-relative": "must be a bundle-relative posix path",
	"escapes-bundle": "resolves outside the bundle root",
	"not-markdown": "must name a .md file",
	duplicate: "was given more than once",
	"no-directory": "names a directory that does not exist in the bundle",
} as const;

/**
 * An unsaved-document input named a path the overlay cannot honestly shadow:
 * absolute or backslashed (`not-relative`), outside the bundle
 * (`escapes-bundle`), not a markdown file (`not-markdown`), the same file as
 * an earlier input after normalization (`duplicate`), or under a directory that
 * does not exist on disk, so the bundle walk would never reach it
 * (`no-directory`). Exit 64: a usage error.
 *
 * @public
 */
export class DocumentPathError extends Schema.TaggedError<DocumentPathError>()("DocumentPathError", {
	path: Schema.String,
	reason: Schema.Literals(["not-relative", "escapes-bundle", "not-markdown", "duplicate", "no-directory"]),
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return `document path "${this.path}" ${DOCUMENT_PATH_REASON_TEXT[this.reason]}`;
	}
}

/**
 * `okfit query list` named a type or tag the config does not declare. `valid`
 * is the sorted declared names. Exit 64: a usage error.
 *
 * @public
 */
export class QueryUnknownVocabularyError extends Schema.TaggedError<QueryUnknownVocabularyError>()(
	"QueryUnknownVocabularyError",
	{
		kind: Schema.Literals(["type", "tag"]),
		requested: Schema.String,
		valid: Schema.Array(Schema.String),
	},
) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return `${this.kind} "${this.requested}" is not declared in the config; declared: ${this.valid.join(", ")}`;
	}
}

/**
 * A query's concept id named no concept: empty after normalisation
 * (`empty-id`) or absent from the bundle (`not-a-concept`). Exit 3.
 *
 * @public
 */
export class QueryConceptNotFoundError extends Schema.TaggedError<QueryConceptNotFoundError>()(
	"QueryConceptNotFoundError",
	{
		id: Schema.String,
		reason: Schema.Literals(["empty-id", "not-a-concept"]),
	},
) {
	override readonly [Runtime.errorExitCode] = 3;
	override get message(): string {
		if (this.reason === "empty-id") return "a concept id must not be empty";
		return `no concept "${this.id}" in this bundle`;
	}
}

/**
 * `okfit query list` was given contradictory selection flags. Exit 64: a
 * usage error.
 *
 * @public
 */
export class QuerySelectionError extends Schema.TaggedError<QuerySelectionError>()("QuerySelectionError", {
	reason: Schema.Literals(["verified-conflict", "browse-needs-terminal"]),
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		if (this.reason === "browse-needs-terminal") {
			return "run in a terminal to browse interactively; use okfit query list/get/neighbors";
		}
		return "query list takes --verified or --unverified, not both";
	}
}

/**
 * One argument that did not resolve to a concept target.
 *
 * @public
 */
export const TargetFailure = Schema.Struct({
	arg: Schema.String,
	reason: Schema.Literals(["not-found", "ambiguous", "outside-bundle", "reserved", "not-a-concept"]),
	suggestion: Schema.optionalKey(Schema.String),
	candidates: Schema.optionalKey(Schema.Tuple([Schema.String, Schema.String])),
});
/** @public */
export type TargetFailure = typeof TargetFailure.Type;

const targetLine = (failure: TargetFailure): string => {
	switch (failure.reason) {
		case "ambiguous":
			return `"${failure.arg}" is ambiguous: it names both ${failure.candidates?.[0]} and ${failure.candidates?.[1]}; pass an id or an absolute path`;
		case "outside-bundle":
			return `"${failure.arg}" is outside the bundle`;
		case "reserved":
			return `"${failure.arg}" is a reserved file, not a concept`;
		case "not-a-concept":
			return `"${failure.arg}" did not load as a concept (run okfit validate)`;
		default:
			return `no concept "${failure.arg}"${failure.suggestion === undefined ? "" : ` (did you mean ${failure.suggestion}?)`}`;
	}
};

/**
 * One or more concept targets did not resolve. Every bad argument is listed;
 * nothing ran. Exit 64: a usage error.
 *
 * @public
 */
export class TargetResolutionError extends Schema.TaggedError<TargetResolutionError>()("TargetResolutionError", {
	failures: Schema.Array(TargetFailure),
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return this.failures.map(targetLine).join("\n");
	}
}

/**
 * `okfit mv` refused before writing anything. `outside-bundle`, `destination-exists`, `reserved`,
 * `same-path` and `invalid-name` (whitespace in a destination path segment) name a bad destination
 * (`detail` is the destination); `unrewritable` lists every link that needs rewriting for this move
 * (`file: url`, one per line) whose URL text could not be located; `project-file` refuses to move the
 * bundle's root project file (`detail` is its path), which must stay at the bundle root;
 * `unloaded-files` lists (one per line) the bundle's Markdown files okfit could not read (unclosed or
 * unparseable frontmatter), whose links to the moved file could not be rewritten; a file that is merely not a
 * concept (no frontmatter, or no `type`) is scanned and never listed.
 *
 * @public
 */
export class MoveError extends Schema.TaggedError<MoveError>()("MoveError", {
	reason: Schema.Literals([
		"outside-bundle",
		"destination-exists",
		"reserved",
		"same-path",
		"invalid-name",
		"unrewritable",
		"project-file",
		"unloaded-files",
	]),
	detail: Schema.optionalKey(Schema.String),
}) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		const detail = this.detail ?? "";
		if (this.reason === "outside-bundle") return `destination ${detail} is outside the bundle`;
		if (this.reason === "destination-exists") return `destination ${detail} already exists`;
		if (this.reason === "reserved") return `${detail} is a reserved file name`;
		if (this.reason === "same-path") return "source and destination are the same file";
		if (this.reason === "invalid-name") return `destination ${detail} contains whitespace; name it without spaces`;
		if (this.reason === "project-file")
			return `${detail} is the bundle's project file and must stay at the bundle root; edit it in place`;
		if (this.reason === "unloaded-files")
			return `these Markdown files are in the bundle but did not load as concepts, so their links to the moved file cannot be rewritten; run \`okfit validate\` and fix them first:\n${detail}`;
		return `these links could not be located for rewriting; nothing was moved:\n${detail}`;
	}
}
