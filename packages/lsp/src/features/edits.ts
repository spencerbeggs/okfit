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
 * sent as a `documentChanges` entry carrying that buffer's version, so a
 * client whose buffer has moved on since refuses the edit instead of
 * applying it at stale offsets.
 *
 * @packageDocumentation
 */
import type { Git } from "@effected/git";
import type { MarkdownEdit } from "@effected/markdown";
import { FrontmatterSource } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import { YamlDocument } from "@effected/yaml";
import type { LoadedConcept, OkfitConfig, Status } from "@okfit/core";
import { DiagnosticRange, Timestamp } from "@okfit/core";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "@okfit/engine";
import { Derivation } from "@okfit/profiles";
import type { DateTime } from "effect";
import { Effect, Option, Schema } from "effect";
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
	| { readonly _tag: "DraftCannotBeVerified" };

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
	/** Every `verified[].by` string in the frontmatter, in order. */
	readonly verifiedBy: ReadonlyArray<string>;
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
		const verifiedBy = Array.isArray(verified)
			? verified.flatMap((entry) => {
					const by = field(entry, "by");
					return typeof by === "string" ? [by] : [];
				})
			: [];
		return Option.some({
			handle: owner.value,
			text,
			version,
			status: typeof status === "string" ? status : undefined,
			verifiedBy,
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
 * `TextEdit`s over `target.text` that append one `verified` entry (`by`
 * `actor`, `at` the encoded `now`), or `EditFailure` when the concept is a
 * draft or already carries a `verified` entry by `actor` (the editor action
 * follows `okfit verify --batch`'s skip rules, not the single-concept
 * `okfit verify <id>`), or the `verified` shape is one
 * `FrontmatterEdits.verified` cannot splice.
 *
 * @public
 */
export const verifiedTextEdits = (
	target: EditTarget,
	actor: string,
	now: DateTime.Utc,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure> =>
	Effect.gen(function* () {
		if (target.status === "draft") return yield* Effect.fail<EditFailure>({ _tag: "DraftCannotBeVerified" });
		if (target.verifiedBy.includes(actor))
			return yield* Effect.fail<EditFailure>({ _tag: "AlreadyVerified", by: actor });
		const at = Schema.encodeSync(Timestamp)(now);
		const edits = yield* FrontmatterEdits.verified(target.text, { by: actor, at }).pipe(
			Effect.mapError((error): EditFailure => toEditFailure(error, "verified")),
		);
		return edits.map((edit) => toTextEdit(target.text, edit));
	});

/**
 * The human actor a `verified` edit in `handle`'s session resolves to
 * (`Derivation.generatedBy` in the session's workspace folder), or
 * `ActorUnresolved` when git has no `user.name`/`user.email` to derive one
 * from. Only that typed failure is mapped; a defect (a git subprocess crash)
 * or an interrupt still propagates.
 *
 * @public
 */
export const resolveActor = (handle: SessionHandle): Effect.Effect<string, EditFailure, Git> =>
	Derivation.generatedBy({ writer: "human", cwd: handle.folder, config: handle.session.config() }).pipe(
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
	}
};
