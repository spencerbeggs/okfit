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
import type { MarkdownEdit } from "@effected/markdown";
import { FrontmatterSource, MarkdownDocument, MarkdownParseOptions, YamlFrontmatter } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import { YamlDocument } from "@effected/yaml";
import type { Actor, LoadedConcept, OkfitConfig, Status } from "@okfit/core";
import { DiagnosticRange, Timestamp, Verification } from "@okfit/core";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "@okfit/engine";
import type { EvaluateInput } from "@okfit/profiles";
import { Derivation, Trust } from "@okfit/profiles";
import type { Crypto, DateTime } from "effect";
import { Effect, Option, Result, Schema } from "effect";
import { toLspRange } from "../convert/range.js";
import { messageOf } from "../internal/messageOf.js";
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
	| { readonly _tag: "DraftCannotBeVerified" }
	| { readonly _tag: "DeprecatedCannotBeVerified" }
	| { readonly _tag: "NotADraft" };

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
	/** The raw top-level `status` value when it is a string, else `undefined` (no explicit status). */
	readonly status: string | undefined;
	/** The `verified[]` entries (`by`, decoded `at`) in order, decoded by core's `Verification.List`: one malformed entry voids the whole list (`[]`). */
	readonly verified: ReadonlyArray<{ readonly by: string; readonly at: DateTime.Utc }>;
	/** The recorded `integrity.verified` binding (`by`, `at`, `content`) when the frontmatter carries a well-formed one. */
	readonly binding: { readonly by: string; readonly at: DateTime.Utc; readonly content: string } | undefined;
	/** The frontmatter block, opening fence through closing fence, as an LSP range over `text`. */
	readonly frontmatter: Range;
}

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
		const verifiedBinding = field(field(data, "integrity"), "verified");
		const bindingBy = field(verifiedBinding, "by");
		const bindingContent = field(verifiedBinding, "content");
		const bindingAt = decodeAt(field(verifiedBinding, "at"));
		return Option.some({
			handle: owner.value,
			binding:
				typeof bindingBy === "string" && typeof bindingContent === "string" && Option.isSome(bindingAt)
					? { by: bindingBy, at: bindingAt.value, content: bindingContent }
					: undefined,
			text,
			version,
			status: typeof status === "string" ? status : undefined,
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
 * a file. `Unsupported` (`yaml-parse-error`) when the frontmatter does not parse.
 */
const contentDigestOf = (text: string): Effect.Effect<string, EditFailure, Crypto.Crypto> =>
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
		return yield* Derivation.contentDigest(raw as Record<string, unknown>, text).pipe(Effect.orDie);
	});

/**
 * The {@link Trust.EvaluateInput} of `target`'s frontmatter (no `generated`: only
 * the integrity state is read, never the drift detail).
 */
const trustInput = (target: EditTarget): EvaluateInput => ({
	verified: target.verified.map((entry) => ({ by: entry.by as Actor, at: entry.at })),
	binding:
		target.binding === undefined
			? undefined
			: { by: target.binding.by as Actor, at: target.binding.at, content: target.binding.content },
	generated: undefined,
	// The actor here comes from Derivation.verifier, so it already passes the allow-list; an empty list keeps the check about content only.
	humans: [],
});

/**
 * Whether `actor` already holds a still-current verification of `target`, by
 * the same decision `okfit validate` makes (`Trust.evaluate`): the latest human
 * entry is bound by `integrity.verified`, the binding names `actor`, and its
 * digest matches `content`. A later unbound human entry supersedes the binding.
 */
const alreadyBound = (target: EditTarget, actor: string, content: string): boolean => {
	const input = trustInput(target);
	return (
		Trust.needsDigest(input) && Trust.evaluate(input, content).integrity === "current" && target.binding?.by === actor
	);
};

/**
 * `TextEdit`s over `target.text` that append one `verified` entry (`by`
 * `actor`, `at` the encoded `now`) and bind it with `integrity.verified`, or
 * `EditFailure` when the concept is a draft, is deprecated, or `actor`'s
 * verification still binds its current content (a drifted one is verified
 * again; the editor action otherwise follows `okfit verify --batch`'s skip
 * rules, not the single-concept `okfit verify <id>`), or the `verified` or
 * `integrity` shape is one `FrontmatterEdits.verified` cannot splice.
 *
 * @public
 */
export const verifiedTextEdits = (
	target: EditTarget,
	actor: string,
	now: DateTime.Utc,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure, Crypto.Crypto> =>
	Effect.gen(function* () {
		if (target.status === "draft") return yield* Effect.fail<EditFailure>({ _tag: "DraftCannotBeVerified" });
		if (target.status === "deprecated") return yield* Effect.fail<EditFailure>({ _tag: "DeprecatedCannotBeVerified" });
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
 * concept's raw `status` is `draft` (a non-draft takes the plain Mark
 * verified), `AlreadyVerified` when `actor`'s verification still binds the
 * current content, or when a shape `FrontmatterEdits.verifiedWithStatus` cannot splice.
 *
 * @public
 */
export const verifiedStableTextEdits = (
	target: EditTarget,
	actor: string,
	now: DateTime.Utc,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure, Crypto.Crypto> =>
	Effect.gen(function* () {
		if (target.status !== "draft") return yield* Effect.fail<EditFailure>({ _tag: "NotADraft" });
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
		Effect.mapError((error): EditFailure => ({ _tag: "ActorUnresolved", message: messageOf(error) })),
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
		case "DraftCannotBeVerified":
			return "the editor's Mark verified skips a draft concept, as okfit verify --batch does";
		case "DeprecatedCannotBeVerified":
			return "the editor's Mark verified skips a deprecated concept, as okfit verify --batch does";
		case "NotADraft":
			return "Mark verified and stable promotes a draft concept; use Mark verified for a concept that is not a draft";
	}
};
