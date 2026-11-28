/**
 * The shared edit machinery `features/actions.ts` (`textDocument/codeAction`)
 * and `features/commands.ts` (`workspace/executeCommand`) both build on: the
 * {@link EditTarget} a request edits, `TextEdit`s for setting a concept's
 * `status` or appending a `verified` entry, the human-actor resolution the
 * `verified` edit depends on, and the versioned `WorkspaceEdit` both send.
 *
 * Every edit is computed against the document's CURRENT text -- the open
 * editor buffer when there is one, not the last-revalidated snapshot, which
 * lags an edit by the scheduler's debounce plus a whole-bundle load -- and
 * sent as a `documentChanges` entry carrying that buffer's version. A
 * command's edit goes over `workspace/applyEdit`, so a client whose buffer
 * has moved on since refuses it instead of applying it at stale offsets; a
 * code action's edit carries no version on the client side
 * (`vscode-languageclient` and VS Code both drop it), so it stays safe only
 * because it is computed from the current buffer at request time.
 *
 * @packageDocumentation
 */

import type { Git } from "@effected/git";
import { ErrorText } from "@effected/kit";
import type { MarkdownEdit } from "@effected/markdown";
import { FrontmatterSource, MarkdownDocument, MarkdownParseOptions, YamlFrontmatter } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import { YamlDocument } from "@effected/yaml";
import type { Actor, DerivedStatus, LoadedConcept, OkfitConfig } from "@okfit/core";
import {
	Concept,
	Derive,
	DiagnosticRange,
	GENERATED_AT_TOLERANCE_TEXT,
	Generated,
	INTEGRITY_KEY,
	Status,
	Timestamp,
	Verification,
	generatedAtIsFuture,
	verificationBlockingRestamp,
} from "@okfit/core";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "@okfit/engine";
import type { EvaluateInput } from "@okfit/profiles";
import { Derivation, Trust } from "@okfit/profiles";
import type { DateTime } from "effect";
import { Effect, Option, Result, Schema } from "effect";
import type { Digest } from "effect/crypto";
import { toLspRange } from "../convert/range.js";
import type { Range, TextEdit, WorkspaceEdit } from "../protocol/types.js";
import type { OpenDocuments } from "../session/documents.js";
import type { SessionHandle, SessionRegistryShape } from "../session/registry.js";
import { conceptAtPath } from "./locate.js";

/**
 * Why a status or verified edit could not be computed. `Unsupported` mirrors
 * `@okfit/engine`'s `UnsupportedFrontmatterError` (a shape
 * `FrontmatterEdits` cannot splice, `key`/`shape` as it reports them) plus a
 * fatally unparseable frontmatter YAML document (`shape: "yaml-parse-error"`).
 *
 * @public
 */
export type EditFailure =
	| { readonly _tag: "NotAConcept" }
	| { readonly _tag: "Unsupported"; readonly key: string; readonly shape: string }
	| { readonly _tag: "ActorUnresolved"; readonly message: string }
	| { readonly _tag: "AlreadyVerified"; readonly by: string }
	| {
			readonly _tag: "NotCurrent";
			readonly generatedAt: string;
			readonly kind: "blocked" | "future" | "near-future";
			readonly blockedBy?: string;
	  }
	| { readonly _tag: "DraftCannotBeVerified" }
	| { readonly _tag: "DeprecatedCannotBeVerified" }
	| { readonly _tag: "UnknownStatusCannotBeVerified"; readonly status: string }
	| { readonly _tag: "NotADraft" }
	| { readonly _tag: "Unhashable"; readonly message: string };

/** The owning session's last-loaded concept, config and project root for `path`; `None` when there is no session, no loaded bundle, or `path` is not a concept. */
interface ConceptSnapshot {
	readonly concept: LoadedConcept;
	readonly config: OkfitConfig;
	/** The workspace folder whose config resolution built the owning session (`handle.folder`) -- V-7's `generatedBy` cwd, never `bundleRoot`. */
	readonly projectRoot: string;
}

/** Mirrors `features/hover.ts`'s `snapshotFor`, but for the concept `inlayHints.ts` needs rather than hover's bundle/graph pair. @internal */
export const conceptSnapshot = (
	registry: SessionRegistryShape,
	path: string,
): Effect.Effect<Option.Option<ConceptSnapshot>> =>
	Effect.gen(function* () {
		const owner = yield* registry.sessionFor(path);
		if (Option.isNone(owner)) return Option.none();
		const bundle = yield* owner.value.session.bundle();
		if (Option.isNone(bundle)) return Option.none();
		const concept = conceptAtPath(bundle.value, path);
		if (Option.isNone(concept)) return Option.none();
		return Option.some({
			concept: concept.value,
			config: owner.value.session.config(),
			projectRoot: owner.value.folder,
		});
	});

/**
 * One concept document as a request edits it: the text every offset and
 * range is computed against, the version a client checks before applying,
 * and the frontmatter facts the action set and the `verified` guards read --
 * all taken from that same text.
 *
 * @public
 */
export interface EditTarget {
	/** The owning session: its `folder` is the actor-resolution cwd, and its identity keys a per-session cache. */
	readonly handle: SessionHandle;
	/** The open editor buffer's text, else the file as the last revalidate loaded it. */
	readonly text: string;
	/** The open editor buffer's version, else `null` (the document is not open). */
	readonly version: number | null;
	/** The raw top-level `status` value, whatever its type (`undefined` when the key is absent); read it with `derivedStatusOf`. */
	readonly status: unknown;
	/** The `verified[]` entries (`by`, decoded `at`) in order, decoded by core's `Verification.List`: one malformed entry voids the whole list (`[]`). */
	readonly verified: ReadonlyArray<{ readonly by: string; readonly at: DateTime.Utc }>;
	/** The recorded `x-okfit-integrity.verified` binding (`by`, `at`, `content`) when the frontmatter carries a well-formed one. */
	readonly binding: { readonly by: string; readonly at: DateTime.Utc; readonly content: string } | undefined;
	/**
	 * `generated.at` from the same text, decoded by core's `Generated` (OKF 0.3 5.2): `undefined` when the block is absent,
	 * malformed, or has no `at`; with no `generated` at all, a legacy top-level `timestamp` stands in, as core folds it (D-15). A verification before it would not be current (5.3), so no verify edit is offered.
	 */
	readonly generated: { readonly by: Actor; readonly at: DateTime.Utc } | undefined;
	/** The frontmatter block, opening fence through closing fence, as an LSP range over `text`. */
	readonly frontmatter: Range;
}

/**
 * The status `Derive.status` derives from a raw frontmatter `status` value: a vocabulary string is itself, an
 * absent value (`undefined`, `null`, `""`, `[]`) is `stable` (OKF 0.3 section 11.2 rule 1), anything else is
 * `unknown`. The editor holds only raw YAML data, not a typed concept, so the absent test is core's
 * `Concept.isAbsent` and only the vocabulary mapping is local; `__test__/features/edits.test.ts` runs both over
 * one table.
 *
 * @public
 */
export const derivedStatusOf = (raw: unknown): DerivedStatus => {
	if (Schema.is(Status)(raw)) return raw;
	return Concept.isAbsent(raw) ? "stable" : "unknown";
};

/** A raw `status` as text, the way `Derive.rawStatus` writes it (a string as is, anything else as JSON). @internal */
export const rawStatusText = (raw: unknown): string =>
	typeof raw === "string" ? raw : (JSON.stringify(raw) ?? String(raw));

/** `value[key]` when `value` is a plain object, else `undefined`. */
const field = (value: unknown, key: string): unknown =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)[key]
		: undefined;

/**
 * The concept at `path` as the editor currently holds it, or `None` when
 * `path` is not a concept in its session's last-loaded snapshot, or its
 * current text has no frontmatter block or unparseable frontmatter YAML
 * (mid-edit, say -- no edit could be spliced into it either).
 *
 * @public
 */
export const editTarget = (
	registry: SessionRegistryShape,
	documents: OpenDocuments,
	path: string,
): Effect.Effect<Option.Option<EditTarget>> =>
	Effect.gen(function* () {
		const owner = yield* registry.sessionFor(path);
		if (Option.isNone(owner)) return Option.none();
		const bundle = yield* owner.value.session.bundle();
		if (Option.isNone(bundle)) return Option.none();
		const concept = conceptAtPath(bundle.value, path);
		if (Option.isNone(concept)) return Option.none();
		const open = yield* documents.get(path);
		const text = Option.isSome(open) ? open.value.text : concept.value.document.source;
		const version = Option.isSome(open) ? open.value.version : null;
		const split = FrontmatterSource.split(text);
		if (split.frontmatter === undefined) return Option.none();
		const parsed = yield* Effect.option(YamlDocument.parse(split.frontmatter.value));
		if (Option.isNone(parsed)) return Option.none();
		const data = parsed.value.toValue();
		const status = field(data, "status");
		const verified = field(data, "verified");
		const decodeAt = Schema.decodeUnknownOption(Timestamp);
		// Core's own decode: a bare mapping is a one-element list, and any malformed entry voids the whole family.
		const verifiedEntries = Option.getOrElse(Schema.decodeUnknownOption(Verification.List)(verified), () => []).map(
			(entry) => ({ by: entry.by, at: entry.at }),
		);
		const verifiedBinding = field(field(data, INTEGRITY_KEY), "verified");
		const bindingBy = field(verifiedBinding, "by");
		const bindingContent = field(verifiedBinding, "content");
		const bindingAt = decodeAt(field(verifiedBinding, "at"));
		const generatedRaw = field(data, "generated");
		const generatedBlock = Schema.decodeUnknownOption(Generated)(generatedRaw);
		const generatedAt = Option.isSome(generatedBlock) ? generatedBlock.value.at : undefined;
		// Core folds a legacy top-level `timestamp` into `generated.at` only when `generated` is absent (D-15); its
		// decode is internal to `@okfit/core`, so this mirrors that one rule with the public `Generated.LEGACY_BY`.
		const legacyAt = Concept.isAbsent(generatedRaw) ? decodeAt(field(data, "timestamp")) : Option.none();
		return Option.some({
			handle: owner.value,
			generated:
				Option.isSome(generatedBlock) && generatedAt !== undefined
					? { by: generatedBlock.value.by, at: generatedAt }
					: Option.isSome(legacyAt)
						? { by: Generated.LEGACY_BY, at: legacyAt.value }
						: undefined,
			binding:
				typeof bindingBy === "string" && typeof bindingContent === "string" && Option.isSome(bindingAt)
					? { by: bindingBy, at: bindingAt.value, content: bindingContent }
					: undefined,
			text,
			version,
			status,
			verified: verifiedEntries,
			frontmatter: toLspRange(text, DiagnosticRange.fromOffset(text, 0, split.bodyOffset)),
		});
	});

/** `UnsupportedFrontmatterError`/`YamlParseError` (`FrontmatterEdits`'s two failure modes) as an `EditFailure`. */
const toEditFailure = (error: UnsupportedFrontmatterError | YamlParseError, key: string): EditFailure =>
	error instanceof UnsupportedFrontmatterError
		? { _tag: "Unsupported", key: error.key, shape: error.shape }
		: { _tag: "Unsupported", key, shape: "yaml-parse-error" };

/** `edit` as an LSP `TextEdit` over `source` -- the same whole-file-offset source `FrontmatterEdits` computed `edit` against. */
const toTextEdit = (source: string, edit: MarkdownEdit): TextEdit => ({
	range: toLspRange(source, DiagnosticRange.fromOffset(source, edit.offset, edit.length)),
	newText: edit.content,
});

/**
 * `TextEdit`s over `target.text` that set its top-level `status` to
 * `status`, or `EditFailure` when its `status` shape is one
 * `FrontmatterEdits.status` cannot splice.
 *
 * @public
 */
export const statusTextEdits = (
	target: EditTarget,
	status: Status,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure> =>
	FrontmatterEdits.status(target.text, status).pipe(
		Effect.mapError((error): EditFailure => toEditFailure(error, "status")),
		Effect.map((edits) => edits.map((edit) => toTextEdit(target.text, edit))),
	);

/**
 * The content digest of `text` as the editor holds it: the parsed frontmatter
 * and body hashed exactly as `Bundle.load` + `Derivation.contentDigest` do for
 * a file. `Unsupported` (`yaml-parse-error`) when the frontmatter does not parse;
 * `Unhashable` when a value cannot be canonicalized (an unpaired surrogate, okfit#327).
 */
const contentDigestOf = (text: string): Effect.Effect<string, EditFailure, Digest.Digest> =>
	Effect.gen(function* () {
		const unparseable = (): EditFailure => ({ _tag: "Unsupported", key: "verified", shape: "yaml-parse-error" });
		const parsed = MarkdownDocument.parseResult(text, MarkdownParseOptions.make({ frontmatter: true }));
		if (Result.isFailure(parsed)) return yield* Effect.fail(unparseable());
		const node = parsed.success.frontmatter;
		if (Option.isNone(node)) return yield* Effect.fail(unparseable());
		const decoded = yield* Effect.result(YamlFrontmatter.decode(node.value));
		if (Result.isFailure(decoded)) return yield* Effect.fail(unparseable());
		const raw = decoded.success;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return yield* Effect.fail(unparseable());
		return yield* Derivation.contentDigest(raw as Record<string, unknown>, text).pipe(
			Effect.mapError((error): EditFailure => ({ _tag: "Unhashable", message: error.message })),
		);
	});

/**
 * The {@link Trust.EvaluateInput} of `target`'s frontmatter. `generated` is passed so integrity sees a binding
 * older than the last change as drifted (`verified-before-change`); the drift detail itself is never read.
 */
const trustInput = (target: EditTarget): EvaluateInput => ({
	verified: target.verified.map((entry) => ({ by: entry.by as Actor, at: entry.at })),
	binding:
		target.binding === undefined
			? undefined
			: { by: target.binding.by as Actor, at: target.binding.at, content: target.binding.content },
	generated: target.generated,
	// The actor here comes from Derivation.verifier, so it already passes the allow-list; an empty list keeps the check about content only.
	humans: [],
});

/**
 * Whether `actor` already holds a still-current verification of `target`, by
 * the same decision `okfit validate` makes (`Trust.evaluate`): the latest human
 * entry is bound by `x-okfit-integrity.verified`, the binding names `actor`, and its
 * digest matches `content`. A later unbound human entry supersedes the binding.
 */
const alreadyBound = (target: EditTarget, actor: string, content: string): boolean => {
	const input = trustInput(target);
	return (
		Trust.needsDigest(input) && Trust.evaluate(input, content).integrity === "current" && target.binding?.by === actor
	);
};

/**
 * OKF 0.3 5.3 (R33): `NotCurrent` when `now` is before `generated.at`, since the entry the edit would write would not
 * count; `kind` is `"future"` when the stamp is more than core's tolerance ahead of `now` (`okfit sync` re-stamps it to now)
 * and `"near-future"` within it. The editor's side of the engine's `VerifyNotCurrentError`; both ask core's `Derive.isCurrent`.
 */
const notCurrent = (target: EditTarget, now: DateTime.Utc): EditFailure | undefined => {
	if (target.generated === undefined || Derive.isCurrent({ generated: target.generated }, now)) return undefined;
	const generatedAt = Schema.encodeSync(Timestamp)(target.generated.at);
	if (!generatedAtIsFuture(target.generated.at, now)) return { _tag: "NotCurrent", generatedAt, kind: "near-future" };
	// More than the tolerance ahead: sync re-stamps it (once any body change is committed), unless a verification dated in between would then count.
	const blocking = verificationBlockingRestamp(
		target.verified.map((entry) => entry.at),
		target.generated.at,
		now,
	);
	return Option.isSome(blocking)
		? { _tag: "NotCurrent", generatedAt, kind: "blocked", blockedBy: Schema.encodeSync(Timestamp)(blocking.value) }
		: { _tag: "NotCurrent", generatedAt, kind: "future" };
};

/**
 * `TextEdit`s over `target.text` that append one `verified` entry (`by`
 * `actor`, `at` the encoded `now`) and bind it with `x-okfit-integrity.verified`, or
 * `EditFailure` when `now` is before `generated.at` (`NotCurrent`), the concept is a draft, is deprecated, or `actor`'s
 * verification still binds its current content (a drifted one is verified
 * again; the editor action otherwise follows `okfit verify --all`'s skip
 * rules, not the single-concept `okfit verify <id>`), or the `verified` or
 * `integrity` shape is one `FrontmatterEdits.verified` cannot splice.
 *
 * @public
 */
export const verifiedTextEdits = (
	target: EditTarget,
	actor: string,
	now: DateTime.Utc,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure, Digest.Digest> =>
	Effect.gen(function* () {
		const derived = derivedStatusOf(target.status);
		if (derived === "draft") return yield* Effect.fail<EditFailure>({ _tag: "DraftCannotBeVerified" });
		if (derived === "deprecated") return yield* Effect.fail<EditFailure>({ _tag: "DeprecatedCannotBeVerified" });
		if (derived === "unknown") {
			return yield* Effect.fail<EditFailure>({
				_tag: "UnknownStatusCannotBeVerified",
				status: rawStatusText(target.status),
			});
		}
		const stale = notCurrent(target, now);
		if (stale !== undefined) return yield* Effect.fail(stale);
		const content = yield* contentDigestOf(target.text);
		if (alreadyBound(target, actor, content))
			return yield* Effect.fail<EditFailure>({ _tag: "AlreadyVerified", by: actor });
		const at = Schema.encodeSync(Timestamp)(now);
		const edits = yield* FrontmatterEdits.verified(target.text, { by: actor, at }, content).pipe(
			Effect.mapError((error): EditFailure => toEditFailure(error, "verified")),
		);
		return edits.map((edit) => toTextEdit(target.text, edit));
	});

/**
 * `TextEdit`s over `target.text` that append one `verified` entry (`by`
 * `actor`, `at` the encoded `now`) AND set `status: stable` in one write --
 * `okfit verify --stable`'s combined edit. Fails `NotADraft` unless the
 * concept's derived status is `draft` (a stable or deprecated concept takes
 * the plain Mark verified, or none), `UnknownStatusCannotBeVerified` for a
 * status outside the vocabulary (the editor never replaces one unseen; the user
 * picks a `Set status` action first, unlike the CLI where the human names
 * `--stable`), `AlreadyVerified` when `actor`'s verification still binds the
 * current content, or when a shape `FrontmatterEdits.verifiedWithStatus` cannot splice.
 *
 * @public
 */
export const verifiedStableTextEdits = (
	target: EditTarget,
	actor: string,
	now: DateTime.Utc,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure, Digest.Digest> =>
	Effect.gen(function* () {
		const derived = derivedStatusOf(target.status);
		if (derived === "unknown") {
			return yield* Effect.fail<EditFailure>({
				_tag: "UnknownStatusCannotBeVerified",
				status: rawStatusText(target.status),
			});
		}
		if (derived !== "draft") return yield* Effect.fail<EditFailure>({ _tag: "NotADraft" });
		const stale = notCurrent(target, now);
		if (stale !== undefined) return yield* Effect.fail(stale);
		const content = yield* contentDigestOf(target.text);
		if (alreadyBound(target, actor, content))
			return yield* Effect.fail<EditFailure>({ _tag: "AlreadyVerified", by: actor });
		const at = Schema.encodeSync(Timestamp)(now);
		const edits = yield* FrontmatterEdits.verifiedWithStatus(target.text, { by: actor, at }, "stable", content).pipe(
			Effect.mapError((error): EditFailure => toEditFailure(error, "verified")),
		);
		return edits.map((edit) => toTextEdit(target.text, edit));
	});

/**
 * The human actor a `verified` edit in `handle`'s session resolves to
 * (`Derivation.verifier` in the session's workspace folder), or
 * `ActorUnresolved` when no human resolves, `okfit.actor` is invalid, or the
 * human is not on a non-empty `[actors].humans` (the message says which). Only that typed failure is mapped; a defect (a git subprocess crash)
 * or an interrupt still propagates.
 *
 * @public
 */
export const resolveActor = (handle: SessionHandle): Effect.Effect<string, EditFailure, Git> =>
	Derivation.verifier({ cwd: handle.folder, config: handle.session.config() }).pipe(
		Effect.mapError((error): EditFailure => ({ _tag: "ActorUnresolved", message: ErrorText.describe(error) })),
	);

/**
 * `edits` as a `WorkspaceEdit` over one document at `uri`, versioned with
 * `target.version` (`null` for a document that is not open) so a client
 * refuses it once the buffer has changed since the text it was computed
 * against.
 *
 * @public
 */
export const versionedEdit = (uri: string, target: EditTarget, edits: ReadonlyArray<TextEdit>): WorkspaceEdit => ({
	documentChanges: [{ textDocument: { uri, version: target.version }, edits: [...edits] }],
});

/** The `NotCurrent` message for each `kind`: blocked, future and near-future each name a different next step. */
const describeNotCurrent = (failure: Extract<EditFailure, { readonly _tag: "NotCurrent" }>): string => {
	switch (failure.kind) {
		case "blocked":
			return `the concept's generated.at (${failure.generatedAt}) is later than now, so a verification now would not count (OKF 0.3 5.3); okfit sync will not re-stamp it, because the verification dated ${failure.blockedBy} would then count without a re-verification; a human must correct generated.at or that verification`;
		case "future":
			return `the concept's generated.at (${failure.generatedAt}) is later than now, so a verification now would not count (OKF 0.3 5.3); run okfit sync, which re-stamps it to now (commit any edits to it first), then mark verified again`;
		case "near-future":
			return `the concept's generated.at (${failure.generatedAt}) is later than now by less than ${GENERATED_AT_TOLERANCE_TEXT}, so a verification now would not count yet (OKF 0.3 5.3); check the clock, or mark verified again at or after ${failure.generatedAt}`;
	}
};

/**
 * `failure` as a short human-readable message, for a command handler
 * surfacing why an edit could not be computed.
 *
 * @public
 */
export const describeFailure = (failure: EditFailure): string => {
	switch (failure._tag) {
		case "NotAConcept":
			return "not a concept";
		case "Unsupported":
			return `"${failure.key}"'s frontmatter value is a shape this cannot edit (${failure.shape}); edit it by hand`;
		case "ActorUnresolved":
			return failure.message;
		case "AlreadyVerified":
			return `already verified by ${failure.by}`;
		case "NotCurrent":
			return describeNotCurrent(failure);
		case "DraftCannotBeVerified":
			return "the editor's Mark verified skips a draft concept, as okfit verify --all does";
		case "DeprecatedCannotBeVerified":
			return "the editor's Mark verified skips a deprecated concept, as okfit verify --all does";
		case "UnknownStatusCannotBeVerified":
			return `the status "${failure.status}" is not draft, stable or deprecated; set the status first, as okfit verify refuses it`;
		case "NotADraft":
			return "Mark verified and stable promotes a draft concept; use Mark verified for a concept that is not a draft";
		case "Unhashable":
			return `${failure.message}; fix the value before marking it verified`;
	}
};
