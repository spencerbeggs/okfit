import { AtomicFile } from "@effected/files";
import { MarkdownEdit } from "@effected/markdown";
import type { Actor, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Bundle, ConceptId, Derive, INTEGRITY_KEY, Timestamp, generatedAtIsFuture } from "@okfit/core";
import type { DriftReason } from "@okfit/profiles";
import { Derivation, Trust } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Option, Path, Schema } from "effect";
import { changedConceptIds } from "../changedDuringLoad.js";
import {
	VerifyConceptNotFoundError,
	VerifyContentUnhashableError,
	VerifyNotCurrentError,
	VerifyNothingToRevokeError,
	VerifySelectionError,
	VerifyStatusUnknownError,
	VerifyUnsupportedFrontmatterError,
} from "../errors.js";
import { readSourceKeepingBom } from "../sync/write.js";
import type { ChangeSince } from "./diff.js";
import { changeSince } from "./diff.js";
import { locateIntegrity, removeIntegrityVerified, spliceIntegrityVerified } from "./integrity.js";
import { documentNewline, locate, locateTopLevelScalar, locateVerifiedAt, stripBom } from "./locate.js";
import { locateVerifiedEntries } from "./revoke.js";
import type { PickerCandidate, VerifySkip } from "./select.js";
import {
	notCurrentDetail,
	resolveBatchTypes,
	selectAttestable,
	selectPickerCandidates,
	selectStaleCandidates,
	unknownStatusSkip,
} from "./select.js";
import { orderVerifyEdits, quoteLike, splice, spliceTopLevelScalar } from "./splice.js";

/**
 * The only four diagnostic codes that can co-occur with a MISSING
 * `concepts` entry (V-9, contract §12 note 10): `Bundle.load` emits the three
 * frontmatter codes and returns without a concept, and `decodeConcept`'s two
 * failure branches emit `type-missing` (a block with no `type`) or
 * `frontmatter-unparseable` (a block that is not a mapping). Every other
 * code — `family-invalid`, `computation-runtime-missing`, `legacy-timestamp`
 * — is pushed as an issue while `decodeConcept` still returns a concept, so
 * the concept IS in the map.
 */
const UNDECODABLE_CODES: ReadonlySet<string> = new Set([
	"frontmatter-unparseable",
	"frontmatter-unclosed",
	"frontmatter-missing",
	"type-missing",
]);

/** @internal */
export interface VerifyOptions {
	readonly id: string;
	/** Absolute bundle root, from `resolveProjectConfig`. */
	readonly bundleRoot: string;
	/** Absolute project root — V-7 spells `generatedBy`'s cwd as exactly this. */
	readonly projectRoot: string;
	/** Already merged `DEFAULTS < profile < file` by the caller (D-28). */
	readonly config: OkfitConfig;
	/** `--at` when given, else the `Now` service (K-47/K-49). */
	readonly at: DateTime.Utc;
	/** The clock, to tell a `generated.at` later than now from one later than `--at`; absent: no refusal says "later than now". */
	readonly now?: DateTime.Utc;
	readonly dryRun: boolean;
	/** Issue #185: also set the concept's `status` in the same write. */
	readonly status?: "stable" | "draft";
}

/** @internal */
export interface VerifyResult {
	readonly id: string;
	/** Absolute bundle root, echoed back for `displayRoot`. */
	readonly bundleRoot: string;
	/** Posix bundle-relative path with `.md`, straight off `LoadedConcept.path`. */
	readonly conceptPath: string;
	/** The branded actor string, e.g. `human:spencer`. */
	readonly by: string;
	/** The `Timestamp`-encoded ISO string actually recorded. */
	readonly at: string;
	/** Every PRIOR entry by this same actor, in list order, encoded (V-2). */
	readonly priorAt: ReadonlyArray<string>;
	readonly dryRun: boolean;
	/** The exact bytes `splice`'s edit would insert, written or not. */
	readonly fragment: string;
	/** `null` when no status flag was given; `from` is the RAW frontmatter status. */
	readonly status: { readonly from: string | null; readonly to: "stable" | "draft" } | null;
	/** The exact status bytes spliced, or `null` when no status edit was made. */
	readonly statusFragment: string | null;
	/** The content digest `x-okfit-integrity.verified` was bound to; the digest of the file before AND after the edit. */
	readonly content: string;
	/** Why the concept's prior human verification no longer bound it, or `null` when it did not drift. */
	readonly priorDrift: DriftReason | null;
}

/**
 * Issue #138: options for {@link runVerifyBatch}. `types` restricts the
 * selected concept types; empty selects every type whose `config.types`
 * declaration sets `require_verified = true`.
 *
 * @public
 */
export interface VerifyBatchOptions {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly at: DateTime.Utc;
	/** The clock; absent: no refusal says "later than now". */
	readonly now?: DateTime.Utc;
	readonly dryRun: boolean;
	/** Restrict to these types; empty = every type with `require_verified = true`. */
	readonly types: ReadonlyArray<string>;
}

export type { VerifyBatchSkipReason } from "./select.js";

/**
 * The result of {@link runVerifyBatch}.
 *
 * @public
 */
export interface VerifyBatchResult {
	readonly bundleRoot: string;
	readonly by: string;
	readonly at: string;
	readonly dryRun: boolean;
	/** In bundle iteration order; each carries the exact fragment written (or that would be). */
	readonly verified: ReadonlyArray<{ readonly id: string; readonly conceptPath: string; readonly fragment: string }>;
	readonly skipped: ReadonlyArray<VerifySkip>;
}

interface PreparedVerify {
	readonly absolutePath: string;
	readonly finalText: string;
	readonly fragment: string;
	readonly statusFragment: string | null;
	readonly priorAt: ReadonlyArray<string>;
	readonly content: string;
}

/**
 * Refuses a verification time (`--at`) more than the five-minute clock-skew tolerance later than `now`: a verification
 * records when the review happened, and one dated in the future would put the concept in the states the stamp guard
 * exists to prevent. Exactly `now` plus the tolerance is accepted. Pure; the CLI calls it right after decoding `--at`,
 * and `runVerify`, `runVerifyBatch` and `runVerifyIds` call it first when given `now`.
 *
 * @public
 */
export const futureAtRefusal = (at: DateTime.Utc, now: DateTime.Utc): VerifySelectionError | undefined =>
	generatedAtIsFuture(at, now)
		? new VerifySelectionError({ reason: "at-future", detail: Schema.encodeSync(Timestamp)(at) })
		: undefined;

/** Fails with the `at-future` refusal when `now` is known and `at` is too far ahead of it; else does nothing. */
const failIfAtFuture = (at: DateTime.Utc, now: DateTime.Utc | undefined): Effect.Effect<void, VerifySelectionError> => {
	const refusal = now === undefined ? undefined : futureAtRefusal(at, now);
	return refusal === undefined ? Effect.void : Effect.fail(refusal);
};

/**
 * OKF 0.3 5.4: a status outside the vocabulary is not stable, so it is never attested unless the same
 * write replaces it (`--stable`/`--draft`, ruling R11). The one place this rule is spelled: the write path
 * (`prepareVerify`) and the prompt path (`inspectDrift`) both ask it.
 */
const unknownStatusRefusal = (
	concept: LoadedConcept,
	status: "stable" | "draft" | undefined,
): VerifyStatusUnknownError | undefined =>
	status === undefined && Derive.status(concept.frontmatter) === "unknown"
		? new VerifyStatusUnknownError({ id: concept.id, status: Derive.rawStatus(concept.frontmatter) ?? "" })
		: undefined;

/**
 * OKF 0.3 5.3 (ruling R33): a verification dated before the concept's `generated.at` would not count, so it is
 * never written, whether `--at` or a `generated.at` in the future (clock skew) put it there. The one place this
 * rule is spelled (through core's `Derive.isCurrent`): the write path (`prepareVerify`) and the prompt path
 * (`inspectDrift`) both ask it, after the status refusal.
 */
const notCurrentRefusal = (
	concept: LoadedConcept,
	at: DateTime.Utc,
	now?: DateTime.Utc,
): VerifyNotCurrentError | undefined => {
	const detail = notCurrentDetail(concept, at, now);
	return detail === undefined ? undefined : new VerifyNotCurrentError({ id: concept.id, ...detail });
};

/** Steps 9-14 of runVerify: read, locate (fail closed), splice; no write. */
const prepareVerify = Effect.fn("okfit/verify/prepareVerify")(function* (
	bundle: LoadedBundle,
	concept: LoadedConcept,
	actor: Actor,
	when: DateTime.Utc,
	status: "stable" | "draft" | undefined,
	now: DateTime.Utc | undefined,
	// Issue #228: the encoded new `stale_after`; set only by `runVerifyIds`'
	// `refreshStaleAfter`. Also switches a re-attestation to overwrite the
	// actor's existing entry's `at` rather than append a second entry.
	staleAfter: string | undefined = undefined,
) {
	const refusal = unknownStatusRefusal(concept, status);
	if (refusal !== undefined) return yield* refusal;
	const stale = notCurrentRefusal(concept, when, now);
	if (stale !== undefined) return yield* stale;
	const at = Schema.encodeSync(Timestamp)(when);
	// Every key verify writes is excluded from the digest, so this equals the digest of the written file.
	const content = yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source).pipe(
		Effect.catchTag("ContentUnhashableError", (error) =>
			Effect.fail(new VerifyContentUnhashableError({ id: concept.id, path: error.path, detail: error.detail })),
		),
	);
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const absolutePath = path.join(bundle.root, concept.path);
	// `readFileString` decodes with a BOM-stripping `TextDecoder`, which would
	// make `stripBom` a no-op and silently drop the BOM on write-back.
	const source = yield* readSourceKeepingBom(fs, absolutePath);
	const { text, bom } = stripBom(source);
	const located = yield* locate(text);
	if (located._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: located.shape, key: "verified" });
	}
	const priorAt = (concept.frontmatter.verified ?? [])
		.filter((entry) => entry.by === actor)
		.map((entry) => Schema.encodeSync(Timestamp)(entry.at));
	const newline = documentNewline(text);
	let verifiedEdit = splice(located, { by: actor, at }, newline);
	// What a dry run shows for the `verified` edit. The overwrite below edits
	// only the bare timestamp, so it previews the whole resulting entry instead.
	let verifiedPreview = verifiedEdit.content;
	if (staleAfter !== undefined && priorAt.length > 0) {
		const existing = yield* locateVerifiedAt(text, actor);
		if (existing._tag === "replaceScalar") {
			verifiedEdit = MarkdownEdit.make({
				offset: existing.start,
				length: existing.end - existing.start,
				content: quoteLike(existing.quote, at),
			});
			verifiedPreview = `- by: ${actor}${newline}  at: ${at}`;
		}
	}
	let statusEdit: MarkdownEdit | undefined;
	// A concept already at the target makes no edit, so an unsupported `status`
	// shape on it is deliberately never located: there is nothing to fail on.
	if (status !== undefined && concept.frontmatter.status !== status) {
		const target = yield* locateTopLevelScalar(text, "status");
		if (target._tag === "unsupported") {
			return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: target.shape, key: "status" });
		}
		statusEdit = spliceTopLevelScalar(target, "status", status, newline);
	}
	let staleEdit: MarkdownEdit | undefined;
	// Only a concept that already carries `stale_after` is rolled forward; one
	// without is never given a clock it did not have.
	if (staleAfter !== undefined && concept.frontmatter.stale_after !== undefined) {
		const target = yield* locateTopLevelScalar(text, "stale_after");
		if (target._tag === "unsupported") {
			return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: target.shape, key: "stale_after" });
		}
		// The key is known present (frontmatter.stale_after is set), so this is always a replaceScalar.
		staleEdit = spliceTopLevelScalar(target, "stale_after", staleAfter, newline);
	}
	const integrity = yield* locateIntegrity(text);
	if (integrity._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id: concept.id, shape: integrity.shape, key: INTEGRITY_KEY });
	}
	const integrityEdit = spliceIntegrityVerified(integrity, text, { by: actor, at, content }, newline);
	const ordered = orderVerifyEdits(verifiedEdit, statusEdit, integrityEdit);
	const edits = staleEdit === undefined ? ordered : [...ordered, staleEdit].toSorted((a, b) => a.offset - b.offset);
	return {
		absolutePath,
		finalText: bom + MarkdownEdit.applyAll(text, edits),
		// A rolled-forward `stale_after` is previewed under the entry it accompanies.
		fragment:
			staleEdit === undefined || staleAfter === undefined
				? verifiedPreview
				: `${verifiedPreview.replace(/(?:\r\n|\n)$/, "")}${newline}stale_after: ${staleAfter}`,
		statusFragment: statusEdit?.content ?? null,
		priorAt,
		content,
	} satisfies PreparedVerify;
});

/** The I4/V-16 atomic write: real path, temp beside it, mode preserved, rename. */
const writeVerified = Effect.fn("okfit/verify/writeVerified")(function* (absolutePath: string, finalText: string) {
	yield* AtomicFile.write(absolutePath, finalText);
});

/** Steps 7a-7d of runVerify, shared with `runVerifyIds`: tolerant id, reserved file, located concept. */
const resolveConcept = (bundle: LoadedBundle, rawId: string) =>
	Effect.gen(function* () {
		// Step 7a: tolerant id, the MCP tools' own convention.
		const normalized = ConceptId.normalize(rawId);
		if (Option.isNone(normalized)) {
			return yield* new VerifyConceptNotFoundError({ id: rawId, root: bundle.root, reason: "not-a-concept" });
		}
		const id = normalized.value;
		const conceptFile = ConceptId.toPath(id);

		// Step 7b.
		if (ConceptId.isReservedFile(conceptFile)) {
			return yield* new VerifyConceptNotFoundError({ id, root: bundle.root, reason: "reserved" });
		}

		// Steps 7c and 7d.
		const concept = bundle.concepts.get(id);
		if (concept === undefined) {
			const diagnostic = bundle.diagnostics.find(
				(entry) => entry.file === conceptFile && UNDECODABLE_CODES.has(entry.code),
			);
			return yield* new VerifyConceptNotFoundError({
				id,
				root: bundle.root,
				...(diagnostic === undefined
					? { reason: "not-a-concept" as const }
					: { reason: "undecodable" as const, diagnosticCode: diagnostic.code }),
			});
		}
		return { id, concept };
	});

/**
 * Contract §2.3 steps 6–15. Loads the bundle, resolves the id, resolves the
 * human actor from git, splices exactly one entry into the concept's
 * frontmatter and writes it back atomically.
 *
 * Nothing here reads `stale_after` or a type's `require_verified`; `status`
 * is read to skip a no-op edit under `options.status` (#185) and to refuse a
 * concept whose status is outside `draft | stable | deprecated` (OKF 0.3 5.4)
 * with `VerifyStatusUnknownError`, unless `options.status` replaces it in the
 * same write (R11). `verify` is mechanical, not config-aware (V-4, V-5).
 *
 * @internal
 */
export const runVerify = Effect.fn("okfit/verify/runVerify")(function* (options: VerifyOptions) {
	yield* failIfAtFuture(options.at, options.now);
	// Step 6 (V-10): Bundle.load only — no validate pass, no single-concept
	// core path. Its diagnostics feed the `undecodable` reason below.
	const bundle = yield* Bundle.load({ root: options.bundleRoot });

	// Steps 7a-7d: tolerant id, reserved files, undecodable concepts.
	const { id, concept } = yield* resolveConcept(bundle, options.id);

	// Step 8 (V-7, V-18): once per process, always the git identity (okfit.actor first), allow-listed by [actors].humans.
	const actor = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });

	// Step 12. Both values are already strings; neither is ever re-stringified
	// by a YAML serialiser.
	const at = Schema.encodeSync(Timestamp)(options.at);

	// Steps 9-14: read, locate (fail closed, V-14), splice. Run
	// unconditionally — a dry run must fail on an unsupported shape exactly
	// like a real run would (I3): there is no cheaper preview path that skips
	// classification, and the edit itself is computed unconditionally so a
	// dry run reports the exact fragment it would write.
	const prepared = yield* prepareVerify(bundle, concept, actor, options.at, options.status, options.now);
	const prior = yield* Trust.signal(concept, options.config, options.at);

	// Step 15 (I4/V-16): a temp file beside the real target, then a rename
	// over it, mode preserved -- see `writeVerified`'s own comments.
	if (!options.dryRun) yield* writeVerified(prepared.absolutePath, prepared.finalText);

	return {
		id,
		bundleRoot: bundle.root,
		conceptPath: concept.path,
		by: actor,
		at,
		priorAt: prepared.priorAt,
		dryRun: options.dryRun,
		fragment: prepared.fragment,
		status:
			options.status === undefined ? null : { from: Derive.rawStatus(concept.frontmatter) ?? null, to: options.status },
		statusFragment: prepared.statusFragment,
		content: prepared.content,
		priorDrift: prior.drift?.reason ?? null,
	} satisfies VerifyResult;
});

/**
 * What {@link inspectDrift} found out about one concept before a re-verify.
 *
 * @internal
 */
export interface DriftInspection {
	readonly id: string;
	/** Absolute path of the concept file. */
	readonly absolutePath: string;
	/** Why its human verification no longer binds, or `null` when it does not drift. */
	readonly drift: DriftReason | null;
	/** When `x-okfit-integrity.verified` was bound, the time the shown patch is measured from; absent when unbound. */
	readonly boundAt?: DateTime.Utc;
}

/**
 * Read-only: is the concept's prior human verification drifted, and if so from
 * when was it bound? The CLI asks this before `runVerify` so it can show what
 * changed. Writes nothing. Fails with `VerifyStatusUnknownError` or `VerifyNotCurrentError` exactly when the write would
 * (a status outside the vocabulary and no `status` option; `now` before `generated.at`), so a prompt is never shown for a refusal.
 *
 * @internal
 */
export const inspectDrift = Effect.fn("okfit/verify/inspectDrift")(function* (options: {
	readonly id: string;
	readonly bundleRoot: string;
	readonly config: OkfitConfig;
	readonly now: DateTime.Utc;
	/** The clock, when `now` is a backdated `--at`; absent: no refusal says "later than now". */
	readonly clock?: DateTime.Utc;
	/** The `--stable`/`--draft` the write will carry, if any. */
	readonly status?: "stable" | "draft";
}) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const { id, concept } = yield* resolveConcept(bundle, options.id);
	const refusal = unknownStatusRefusal(concept, options.status);
	if (refusal !== undefined) return yield* refusal;
	const stale = notCurrentRefusal(concept, options.now, options.clock);
	if (stale !== undefined) return yield* stale;
	const path = yield* Path.Path;
	const signal = yield* Trust.signal(concept, options.config, options.now);
	const boundAt = concept.frontmatter.integrity?.verified?.at;
	return {
		id,
		absolutePath: path.join(bundle.root, concept.path),
		drift: signal.drift?.reason ?? null,
		...(boundAt === undefined ? {} : { boundAt }),
	} satisfies DriftInspection;
});

/**
 * Options for {@link runRevoke}.
 *
 * @internal
 */
export interface RevokeOptions {
	readonly id: string;
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly dryRun: boolean;
}

/**
 * What {@link runRevoke} removed (or, under a dry run, would remove).
 *
 * @internal
 */
export interface RevokeResult {
	readonly id: string;
	readonly bundleRoot: string;
	readonly conceptPath: string;
	/** The resolved actor whose entries were removed. */
	readonly by: string;
	/** The encoded `at` of every removed entry, in list order. */
	readonly removed: ReadonlyArray<string>;
	/** Whether `x-okfit-integrity.verified` (bound to this actor) was removed too. */
	readonly bindingCleared: boolean;
	readonly dryRun: boolean;
}

const prepareRevoke = Effect.fn("okfit/verify/prepareRevoke")(function* (
	bundle: LoadedBundle,
	rawId: string,
	actor: string,
) {
	const { id, concept } = yield* resolveConcept(bundle, rawId);

	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const absolutePath = path.join(bundle.root, concept.path);
	const source = yield* readSourceKeepingBom(fs, absolutePath);
	const { text, bom } = stripBom(source);

	const entries = yield* locateVerifiedEntries(text, actor);
	if (entries._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id, shape: entries.shape, key: "verified" });
	}
	if (entries._tag === "none") return yield* new VerifyNothingToRevokeError({ id, actor });

	const integrity = yield* locateIntegrity(text);
	if (integrity._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id, shape: integrity.shape, key: INTEGRITY_KEY });
	}
	// Read from the parsed tree, so a block that does not decode as a whole still unbinds.
	const bound = integrity._tag === "replace" && integrity.boundBy === actor;
	const unbind = bound ? removeIntegrityVerified(integrity, text) : ({ _tag: "none" } as const);
	if (unbind._tag === "unsupported") {
		return yield* new VerifyUnsupportedFrontmatterError({ id, shape: unbind.shape, key: INTEGRITY_KEY });
	}

	const edits = [
		...entries.removals.map((span) =>
			MarkdownEdit.make({ offset: span.start, length: span.end - span.start, content: "" }),
		),
		...(unbind._tag === "edit" ? [unbind.edit] : []),
	].toSorted((a, b) => a.offset - b.offset);
	const finalText = bom + MarkdownEdit.applyAll(text, edits);
	const removed = (concept.frontmatter.verified ?? [])
		.filter((entry) => entry.by === actor)
		.map((entry) => Schema.encodeSync(Timestamp)(entry.at));

	return {
		absolutePath,
		finalText,
		result: {
			id,
			bundleRoot: bundle.root,
			conceptPath: concept.path,
			by: actor,
			removed,
			bindingCleared: unbind._tag === "edit",
			dryRun: false,
		},
	};
});

/**
 * `okfit verify --revoke`: removes every `verified` entry by the resolved
 * human actor (the same git identity `verify` records) and, when
 * `x-okfit-integrity.verified` is bound to that actor, that slot too, deleting the
 * whole `integrity` block only when nothing else is left in it. Every cut is a
 * byte-precise splice; an unsupported `verified` or `integrity` shape fails
 * closed with the file untouched, and an actor with no entry fails
 * `VerifyNothingToRevokeError`. Another actor's entries and binding are never
 * touched, so they then read as `entry-superseded` or unbound by themselves.
 *
 * @internal
 */
export const runRevoke = Effect.fn("okfit/verify/runRevoke")(function* (options: RevokeOptions) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const actor = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });
	const prepared = yield* prepareRevoke(bundle, options.id, actor);
	if (!options.dryRun) yield* writeVerified(prepared.absolutePath, prepared.finalText);
	return { ...prepared.result, dryRun: options.dryRun } satisfies RevokeResult;
});

/**
 * Options for {@link runRevokeIds}.
 *
 * @internal
 */
export interface RevokeIdsOptions {
	readonly ids: ReadonlyArray<string>;
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly dryRun: boolean;
}

/**
 * {@link runRevoke} for several concepts, all or nothing: every revoke is
 * prepared before the first write, so one concept with nothing to revoke (or an
 * unsupported shape, or an unknown id) fails the call with the tree untouched.
 * Duplicate ids collapse to one. Results come back in the order given.
 *
 * @internal
 */
export const runRevokeIds = Effect.fn("okfit/verify/runRevokeIds")(function* (options: RevokeIdsOptions) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const actor = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });
	const prepared = new Map<string, Effect.Success<ReturnType<typeof prepareRevoke>>>();
	for (const rawId of options.ids) {
		const entry = yield* prepareRevoke(bundle, rawId, actor);
		if (!prepared.has(entry.result.id)) prepared.set(entry.result.id, entry);
	}
	if (!options.dryRun) {
		for (const entry of prepared.values()) yield* writeVerified(entry.absolutePath, entry.finalText);
	}
	return [...prepared.values()].map((entry) => ({ ...entry.result, dryRun: options.dryRun }) satisfies RevokeResult);
});

/**
 * Issue #138. Attests every concept selected by `options.types` (or, when
 * empty, every type whose declaration sets `require_verified = true`, plus
 * every drifted concept of any type) that
 * is not a draft, is not deprecated (#143) and whose `verified` entry by the
 * resolved actor does not already bind its current content (`Trust.signals`). Every candidate is located FIRST -- an unsupported
 * `verified` shape on any one of them fails the whole batch with nothing
 * written, mirroring `runVerify`'s own fail-closed rule at batch scale.
 *
 * @public
 */
export const runVerifyBatch = Effect.fn("okfit/verify/runVerifyBatch")(function* (options: VerifyBatchOptions) {
	yield* failIfAtFuture(options.at, options.now);
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const types = yield* resolveBatchTypes(options.config, options.types);

	const actor = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });
	const at = Schema.encodeSync(Timestamp)(options.at);

	const signals = yield* Trust.signals(bundle, options.config, options.at);
	// No explicit `--type`: also every drifted concept, whatever its type. An
	// explicit type list stays exactly that list.
	const selection = selectAttestable(bundle, types, actor, signals, {
		drifted: options.types.length === 0,
		at: options.at,
		...(options.now === undefined ? {} : { now: options.now }),
	});
	const prepared: Array<{ readonly id: string; readonly conceptPath: string } & PreparedVerify> = [];
	// Every concept is located before any is written: one unsupported
	// shape fails the whole batch with the tree untouched.
	for (const concept of selection.candidates) {
		prepared.push({
			id: concept.id,
			conceptPath: concept.path,
			...(yield* prepareVerify(bundle, concept, actor, options.at, undefined, options.now)),
		});
	}

	if (!options.dryRun) {
		for (const entry of prepared) yield* writeVerified(entry.absolutePath, entry.finalText);
	}

	return {
		bundleRoot: bundle.root,
		by: actor,
		at,
		dryRun: options.dryRun,
		verified: prepared.map(({ id, conceptPath, fragment }) => ({ id, conceptPath, fragment })),
		// A concept that changed under the load was never considered: say so, rather than leave a batch that looks complete.
		skipped: [
			...selection.skipped,
			...changedConceptIds(bundle).map((id) => ({ id, reason: "changed-during-read" as const })),
		],
	} satisfies VerifyBatchResult;
});

/**
 * Issue #214: options for {@link runVerifyIds}.
 *
 * @public
 */
export interface VerifyIdsOptions {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly at: DateTime.Utc;
	/** The clock; absent: no refusal says "later than now". */
	readonly now?: DateTime.Utc;
	readonly dryRun: boolean;
	/** Concept ids, resolved as `runVerify` resolves one (tolerant: leading slash, trailing `.md`). */
	readonly ids: ReadonlyArray<string>;
	/** Also set `status: stable` on every selected concept whose status is `draft`. Default `false`. */
	readonly promote?: boolean;
	/**
	 * Issue #228: also roll each selected concept's existing `stale_after`
	 * forward to `Derivation.staleAfter(at, config)` in the same write, and
	 * overwrite the actor's existing `verified` entry's `at` instead of
	 * appending a duplicate. A concept without `stale_after` gets none added.
	 * Default `false`: plain verify never touches `stale_after`.
	 */
	readonly refreshStaleAfter?: boolean;
}

/**
 * Issue #214. Attests an explicit list of concept ids in one all-or-nothing
 * batch. Every id is resolved exactly as {@link runVerify} resolves it, and
 * every concept is located and spliced BEFORE any file is written, so one
 * unknown id, reserved file or unsupported `verified`/`status` shape fails the
 * whole call with the tree untouched. An explicit pick is second-guessed in
 * two ways. A concept whose status is outside `draft | stable | deprecated`
 * (OKF 0.3 5.4) is skipped with the reason `unknown-status` and its raw `status` (#507), even under
 * `promote` (which only promotes a draft); it is never verified or written, and is checked before the next rule.
 * A concept whose `generated.at` is later than `at` is skipped with the reason `not-current`.
 * Drafts, deprecated and already-attested concepts are all attested. `skipped` is in the order the ids were given and
 * the rest are verified; when every id is skipped nothing is written and the call succeeds.
 * Duplicate ids (after normalisation) are written
 * once. With `promote`, a draft's `status` becomes `stable` in the same write.
 *
 * @public
 */
export const runVerifyIds = Effect.fn("okfit/verify/runVerifyIds")(function* (options: VerifyIdsOptions) {
	yield* failIfAtFuture(options.at, options.now);
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const actor = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });
	const at = Schema.encodeSync(Timestamp)(options.at);

	// Whole-second ISO with `Z`, matching how this repo writes `stale_after`.
	const staleAfter =
		options.refreshStaleAfter === true
			? Schema.encodeSync(Timestamp)(
					DateTime.makeUnsafe(
						Math.floor(DateTime.toEpochMillis(Derivation.staleAfter(options.at, options.config)) / 1000) * 1000,
					),
				)
			: undefined;

	const concepts = new Map<string, LoadedConcept>();
	for (const rawId of options.ids) {
		const { id, concept } = yield* resolveConcept(bundle, rawId);
		concepts.set(id, concept);
	}

	const prepared: Array<{ readonly id: string; readonly conceptPath: string } & PreparedVerify> = [];
	const skipped: Array<VerifySkip> = [];
	for (const [id, concept] of concepts) {
		// An unknown status is never verified here: skip it (#507), before the not-current check, so it is never
		// written. `okfit verify <one id>` still refuses it, through `runVerify`.
		if (Derive.status(concept.frontmatter) === "unknown") {
			skipped.push(unknownStatusSkip(id, concept));
			continue;
		}
		// A concept whose `generated.at` is later than `at` cannot be verified now: skip it, verify the rest.
		const notCurrent = notCurrentDetail(concept, options.at, options.now);
		if (notCurrent !== undefined) {
			skipped.push({ id, reason: "not-current", notCurrent });
			continue;
		}
		const status = options.promote === true && Derive.status(concept.frontmatter) === "draft" ? "stable" : undefined;
		prepared.push({
			id,
			conceptPath: concept.path,
			...(yield* prepareVerify(bundle, concept, actor, options.at, status, options.now, staleAfter)),
		});
	}

	if (!options.dryRun) {
		for (const entry of prepared) yield* writeVerified(entry.absolutePath, entry.finalText);
	}

	return {
		bundleRoot: bundle.root,
		by: actor,
		at,
		dryRun: options.dryRun,
		verified: prepared.map(({ id, conceptPath, fragment }) => ({ id, conceptPath, fragment })),
		skipped,
	} satisfies VerifyBatchResult;
});

/**
 * Options for {@link loadPickerCandidates}.
 *
 * @public
 */
export interface PickerCandidatesOptions {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	/** The verification time a row's `generated.at` is checked against; absent: `now`. */
	readonly at?: DateTime.Utc;
	/** The instant a left-out row's not-current kind is judged against; absent: the clock. */
	readonly now?: DateTime.Utc;
}

/** The loaders' result: rows a verification at the verification time would count for, and the ids left out. */
interface PickerRows {
	readonly by: string;
	readonly candidates: ReadonlyArray<PickerCandidate>;
	/** The concepts left out because their `generated.at` is later than the verification time, sorted by id. */
	readonly leftOut: ReadonlyArray<VerifySkip>;
}

/** Drops the rows whose concept is not current at `at`, recording each (sorted by id) with its detail in `leftOut`. */
const leaveOutNotCurrent = (
	bundle: LoadedBundle,
	rows: ReadonlyArray<PickerCandidate>,
	at: DateTime.Utc,
	now: DateTime.Utc,
): { readonly candidates: ReadonlyArray<PickerCandidate>; readonly leftOut: ReadonlyArray<VerifySkip> } => {
	const keep: Array<PickerCandidate> = [];
	const leftOut: Array<VerifySkip> = [];
	const byId = new Map<string, LoadedConcept>(bundle.concepts);
	for (const row of rows) {
		const concept = byId.get(row.id);
		const notCurrent = concept === undefined ? undefined : notCurrentDetail(concept, at, now);
		if (notCurrent !== undefined) leftOut.push({ id: row.id, reason: "not-current", notCurrent });
		else keep.push(row);
	}
	return { candidates: keep, leftOut: leftOut.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
};

/** The rows with `path` joined onto the bundle root, so the picker's callers get absolute file paths. */
const absolutePaths = (
	rows: ReadonlyArray<PickerCandidate>,
	path: Path.Path,
	root: string,
): ReadonlyArray<PickerCandidate> => rows.map((row) => ({ ...row, path: path.join(root, row.path) }));

/**
 * The interactive verify picker's starting point: loads the bundle, resolves
 * the human actor from git exactly as {@link runVerify} does, and selects the
 * rows that actor may still attest. Reads only; nothing is written.
 *
 * @public
 */
export const loadPickerCandidates = Effect.fn("okfit/verify/loadPickerCandidates")(function* (
	options: PickerCandidatesOptions,
) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const by = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });
	const now = options.now ?? (yield* DateTime.now);
	const signals = yield* Trust.signals(bundle, options.config, now);
	const path = yield* Path.Path;
	const kept = leaveOutNotCurrent(
		bundle,
		selectPickerCandidates(bundle, options.config, by, signals),
		options.at ?? now,
		now,
	);
	return {
		by,
		candidates: absolutePaths(kept.candidates, path, bundle.root),
		leftOut: kept.leftOut,
	} satisfies PickerRows;
});

/**
 * Issue #228: as {@link loadPickerCandidates}, but the rows are the concepts
 * stale at `now` (any type, the actor's own attestations included), for
 * `okfit stale --verify` to re-attest and roll forward. Reads only.
 *
 * @public
 */
export const loadStaleCandidates = Effect.fn("okfit/verify/loadStaleCandidates")(function* (
	options: PickerCandidatesOptions & { readonly now: DateTime.Utc },
) {
	const bundle = yield* Bundle.load({ root: options.bundleRoot });
	const by = yield* Derivation.verifier({ cwd: options.projectRoot, config: options.config });
	const signals = yield* Trust.signals(bundle, options.config, options.now);
	const path = yield* Path.Path;
	const kept = leaveOutNotCurrent(
		bundle,
		selectStaleCandidates(bundle, Derive.staleReport(bundle, options.now), by, signals),
		options.at ?? options.now,
		options.now,
	);
	return {
		by,
		candidates: absolutePaths(kept.candidates, path, bundle.root),
		leftOut: kept.leftOut,
	} satisfies PickerRows;
});

/**
 * The verify picker's diff previews: for each drifted candidate, in candidate
 * order and one at a time, what changed in its file since its verification was
 * bound ({@link changeSince}). A candidate with no binding is `no-baseline`
 * `unbound` without touching git, and a git failure reading the history is
 * `no-baseline` `not-a-repository`, so a preview never fails the picker. Rows
 * that are not drifted get no entry. Reads only.
 *
 * @public
 */
export const loadPreviews = Effect.fn("okfit/verify/loadPreviews")(function* (
	candidates: ReadonlyArray<PickerCandidate>,
) {
	const previews = new Map<string, ChangeSince>();
	for (const candidate of candidates) {
		if (candidate.integrity !== "drifted") continue;
		const at = candidate.boundAt === null ? undefined : DateTime.make(candidate.boundAt);
		const preview: ChangeSince =
			at === undefined || Option.isNone(at)
				? { _tag: "no-baseline", reason: "unbound" }
				: yield* changeSince({ file: candidate.path, at: DateTime.toUtc(at.value) }).pipe(
						Effect.catchTag("GitCommandError", () =>
							Effect.succeed({ _tag: "no-baseline", reason: "not-a-repository" } satisfies ChangeSince),
						),
					);
		previews.set(candidate.id, preview);
	}
	return previews as ReadonlyMap<string, ChangeSince>;
});
