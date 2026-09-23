/**
 * The shared edit machinery `features/actions.ts` (`textDocument/codeAction`)
 * and `features/commands.ts` (`workspace/executeCommand`) both build on:
 * `TextEdit`s for setting a concept's `status` or appending a `verified`
 * entry, and the human-actor resolution both a code action's title and the
 * `verified` edit itself depend on.
 *
 * @packageDocumentation
 */
import type { Git } from "@effected/git";
import type { MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { LoadedConcept, OkfitConfig, Status } from "@okfit/core";
import { Derive, DiagnosticRange, Timestamp } from "@okfit/core";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "@okfit/engine";
import { Derivation } from "@okfit/profiles";
import type { DateTime } from "effect";
import { Effect, Option, Schema } from "effect";
import { toLspRange } from "../convert/range.js";
import { messageOf } from "../internal/messageOf.js";
import type { TextEdit } from "../protocol/types.js";
import type { SessionRegistryShape } from "../session/registry.js";
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

/** Mirrors `features/hover.ts`'s `snapshotFor`, but for the concept `edits.ts`'s callers need rather than hover's bundle/graph pair. @internal */
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
 * `TextEdit`s that set the concept at `path`'s top-level `status` to
 * `status`, or `EditFailure` when `path` is not a concept or its `status`
 * shape is one `FrontmatterEdits.status` cannot splice.
 *
 * @public
 */
export const statusTextEdits = (
	registry: SessionRegistryShape,
	path: string,
	status: Status,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure> =>
	Effect.gen(function* () {
		const snapshot = yield* conceptSnapshot(registry, path);
		if (Option.isNone(snapshot)) return yield* Effect.fail<EditFailure>({ _tag: "NotAConcept" });
		const source = snapshot.value.concept.document.source;
		const edits = yield* FrontmatterEdits.status(source, status).pipe(
			Effect.mapError((error): EditFailure => toEditFailure(error, "status")),
		);
		return edits.map((edit) => toTextEdit(source, edit));
	});

/**
 * `TextEdit`s that append one `verified` entry (`by` the resolved human
 * actor, `at` the encoded `now`) to the concept at `path`, or `EditFailure`
 * when `path` is not a concept, the concept is a draft (OKF concepts never
 * verify a draft), the concept already carries a `verified` entry by the
 * resolved actor, the actor cannot be resolved, or the `verified` shape is
 * one `FrontmatterEdits.verified` cannot splice.
 *
 * @public
 */
export const verifiedTextEdits = (
	registry: SessionRegistryShape,
	path: string,
	now: DateTime.Utc,
): Effect.Effect<ReadonlyArray<TextEdit>, EditFailure, Git> =>
	Effect.gen(function* () {
		const snapshot = yield* conceptSnapshot(registry, path);
		if (Option.isNone(snapshot)) return yield* Effect.fail<EditFailure>({ _tag: "NotAConcept" });
		const { concept, config, projectRoot } = snapshot.value;
		if (Derive.status(concept.frontmatter) === "draft") {
			return yield* Effect.fail<EditFailure>({ _tag: "DraftCannotBeVerified" });
		}
		const actor = yield* Derivation.generatedBy({ writer: "human", cwd: projectRoot, config }).pipe(
			Effect.mapError((error): EditFailure => ({ _tag: "ActorUnresolved", message: messageOf(error) })),
		);
		const already = (concept.frontmatter.verified ?? []).find((entry) => entry.by === actor);
		if (already !== undefined) return yield* Effect.fail<EditFailure>({ _tag: "AlreadyVerified", by: already.by });
		const at = Schema.encodeSync(Timestamp)(now);
		const source = concept.document.source;
		const edits = yield* FrontmatterEdits.verified(source, { by: actor, at }).pipe(
			Effect.mapError((error): EditFailure => toEditFailure(error, "verified")),
		);
		return edits.map((edit) => toTextEdit(source, edit));
	});

/** The project root a resolution failure was already logged for, so a repeated call logs at most once each. */
const loggedActorFailures = new Set<string>();

/**
 * The human actor a `verified` edit for the concept at `path` would resolve
 * to, or `None` when it cannot be resolved (git has no `user.name`/
 * `user.email` to derive one from, or `path` is not a concept). A resolution
 * failure is logged once per project root, at `logDebug`, never to stdout.
 *
 * @public
 */
export const humanActor = (
	registry: SessionRegistryShape,
	path: string,
): Effect.Effect<Option.Option<string>, never, Git> =>
	Effect.gen(function* () {
		const snapshot = yield* conceptSnapshot(registry, path);
		if (Option.isNone(snapshot)) return Option.none();
		const { config, projectRoot } = snapshot.value;
		return yield* Derivation.generatedBy({ writer: "human", cwd: projectRoot, config }).pipe(
			Effect.map((actor): Option.Option<string> => Option.some(actor)),
			// `Effect.catch` recovers only `generatedBy`'s typed `GeneratedByError`
			// channel; a defect (a git subprocess crash) or an interrupt (a
			// shutdown mid-resolution) still propagates rather than being read as
			// "no actor" -- `Effect.catchCause` would have swallowed both.
			Effect.catch((error) =>
				Effect.gen(function* () {
					if (!loggedActorFailures.has(projectRoot)) {
						loggedActorFailures.add(projectRoot);
						yield* Effect.logDebug(
							`okfit-lsp: could not resolve a human actor for ${projectRoot}: ${messageOf(error)}`,
						);
					}
					return Option.none<string>();
				}),
			),
		);
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
			return "a draft concept cannot be verified";
	}
};
