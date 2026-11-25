import type { LoadedBundle, LoadedConcept, OkfitConfig, StaleConcept } from "@okfit/core";
import { Derive, Timestamp, generatedAtIsFuture, verificationBlockingRestamp } from "@okfit/core";
import type { ConceptSignal, IntegrityState } from "@okfit/profiles";
import { DateTime, Effect, Option, Schema } from "effect";
import { VerifySelectionError } from "../errors.js";

/**
 * Why a candidate concept was skipped by batch selection: `"draft"` and
 * `"deprecated"` mirror `status`, `"unknown-status"` is a `status` outside the vocabulary (OKF 0.3 §5.4),
 * `"already-verified"` means the actor's
 * `verified` entry is bound, current by OKF 0.3 §5.3 (its `at` is not before `generated.at`), and covering the
 * concept's current content, and `"not-current"` means the concept's `generated.at` is later than the verification
 * time, so a verification made then would not count (OKF 0.3 §5.3).
 *
 * @public
 */
export type VerifyBatchSkipReason = "draft" | "deprecated" | "unknown-status" | "already-verified" | "not-current";

/**
 * Why a verification at `at` would not count for a concept (OKF 0.3 5.3), as encoded timestamps. `kind` compares
 * `generatedAt` to now when now is known: `"blocked"` (more than the 5-minute tolerance later, and a verification dated
 * between now and the stamp, `blockedBy`, would start to count if sync re-stamped it), `"future"` (more than the
 * tolerance later) or `"near-future"` (later, within it); absent when now is unknown or `generatedAt` is not later than
 * now, so only the verification time is to blame.
 *
 * @public
 */
export interface NotCurrentDetail {
	readonly at: string;
	readonly generatedAt: string;
	readonly kind?: "blocked" | "future" | "near-future";
	readonly blockedBy?: string;
}

/**
 * One concept a batch, an id list or a picker passed over, and why. A `not-current` skip carries its
 * {@link NotCurrentDetail}; an `unknown-status` skip carries the raw `status`.
 *
 * @public
 */
export interface VerifySkip {
	readonly id: string;
	readonly reason: VerifyBatchSkipReason;
	readonly notCurrent?: NotCurrentDetail;
	/** On an `unknown-status` skip: the raw `status` as written (`Derive.rawStatus`), `""` when it has no text form. */
	readonly status?: string;
}

/**
 * The `unknown-status` skip for a concept, carrying its raw `status`.
 *
 * @internal
 */
export const unknownStatusSkip = (id: string, concept: LoadedConcept): VerifySkip => ({
	id,
	reason: "unknown-status",
	status: Derive.rawStatus(concept.frontmatter) ?? "",
});

/**
 * The outcome of {@link selectAttestable}.
 *
 * @public
 */
export interface AttestableSelection {
	/** In bundle iteration order. */
	readonly candidates: ReadonlyArray<LoadedConcept>;
	readonly skipped: ReadonlyArray<VerifySkip>;
}

/**
 * Whether `concept` is verified by `actor` AND that verification is held: the signal is `current` (okfit's integrity
 * rule: the bound entry is the latest human entry, its actor passes `[actors].humans`, it is a current event under
 * OKF 0.3 §5.3, and its binding covers the current content) and
 * `x-okfit-integrity.verified` names `actor`. A drifted concept (changed content, or verified before the last change), or
 * one whose current binding is another actor's, is not.
 */
const attestedBy = (concept: LoadedConcept, actor: string, signals: ReadonlyMap<string, ConceptSignal>): boolean =>
	signals.get(concept.id)?.integrity === "current" && concept.frontmatter.integrity?.verified?.by === actor;

/**
 * Whether a verification made at `at` would not count for `concept`: its `generated.at` is set and later than `at`
 * (OKF 0.3 §5.3). The one test the batch, the id list and both pickers share.
 *
 * @public
 */
export const notCurrentAt = (concept: LoadedConcept, at: DateTime.Utc): boolean =>
	notCurrentDetail(concept, at) !== undefined;

/**
 * Why a verification made at `at` would not count for `concept`, or `undefined` when it would (OKF 0.3 5.3, ruling
 * R33). The one place the rule and its kinds are spelled: the single-id refusal, the id list, the batch and both
 * pickers all read it. `now`, when known, tells a `generated.at` later than now from one later than only `at`.
 *
 * @public
 */
export const notCurrentDetail = (
	concept: LoadedConcept,
	at: DateTime.Utc,
	now?: DateTime.Utc,
): NotCurrentDetail | undefined => {
	const generatedAt = concept.frontmatter.generated?.at;
	if (generatedAt === undefined || Derive.isCurrent(concept.frontmatter, at)) return undefined;
	// How far ahead of now the stamp is, when now is known; the engine never claims "later than now" without it.
	const future = now !== undefined && DateTime.isGreaterThan(generatedAt, now);
	// A future stamp sync would skip: a verification dated between now and it would start to count if it were lowered.
	const blockedBy =
		future && generatedAtIsFuture(generatedAt, now)
			? Option.getOrUndefined(
					verificationBlockingRestamp(
						(concept.frontmatter.verified ?? []).map((entry) => entry.at),
						generatedAt,
						now,
					),
				)
			: undefined;
	const kind = !future
		? undefined
		: blockedBy !== undefined
			? ("blocked" as const)
			: generatedAtIsFuture(generatedAt, now)
				? ("future" as const)
				: ("near-future" as const);
	return {
		at: Schema.encodeSync(Timestamp)(at),
		generatedAt: Schema.encodeSync(Timestamp)(generatedAt),
		...(kind === undefined ? {} : { kind }),
		...(blockedBy === undefined ? {} : { blockedBy: Schema.encodeSync(Timestamp)(blockedBy) }),
	};
};

/**
 * Issue #138/#143: which concepts of `types` the actor may attest in one
 * batch. A draft is unsettled, a deprecated concept is retired (#143) and an unknown status is not stable
 * (OKF 0.3 §5.4), so all three are skipped before the already-verified check. A concept whose
 * verification has drifted (including one made before `generated.at`), or is bound to another actor, is a candidate.
 * With `options.at`, a concept whose `generated.at` is later than `at` is skipped as `not-current`. With `options.drifted`, a drifted concept of any type is considered too,
 * as the picker does: the `verified-drift` lint's remedy is `okfit verify`.
 *
 * @public
 */
export const selectAttestable = (
	bundle: LoadedBundle,
	types: ReadonlySet<string>,
	actor: string,
	signals: ReadonlyMap<string, ConceptSignal>,
	options: { readonly drifted?: boolean; readonly at?: DateTime.Utc; readonly now?: DateTime.Utc } = {},
): AttestableSelection => {
	const candidates: Array<LoadedConcept> = [];
	const skipped: Array<VerifySkip> = [];
	for (const [id, concept] of bundle.concepts) {
		const drifted = options.drifted === true && signals.get(id)?.integrity === "drifted";
		if (!types.has(concept.frontmatter.type) && !drifted) continue;
		const status = Derive.status(concept.frontmatter);
		if (status === "unknown") {
			skipped.push(unknownStatusSkip(id, concept));
			continue;
		}
		if (status === "draft" || status === "deprecated") {
			skipped.push({ id, reason: status });
			continue;
		}
		if (attestedBy(concept, actor, signals)) {
			skipped.push({ id, reason: "already-verified" });
			continue;
		}
		const notCurrent = options.at === undefined ? undefined : notCurrentDetail(concept, options.at, options.now);
		if (notCurrent !== undefined) {
			skipped.push({ id, reason: "not-current", notCurrent });
			continue;
		}
		candidates.push(concept);
	}
	return { candidates, skipped };
};

const requireVerifiedTypes = (config: OkfitConfig): ReadonlySet<string> =>
	new Set(Object.entries(config.types ?? {}).flatMap(([name, spec]) => (spec.require_verified === true ? [name] : [])));

/**
 * One row of the interactive verify picker: a `require_verified` concept the
 * actor has not attested yet.
 *
 * @public
 */
export interface PickerCandidate {
	readonly id: string;
	readonly type: string;
	/** `"stable"` when the concept carries no `status`. */
	readonly status: "draft" | "stable";
	readonly title: string | null;
	readonly description: string | null;
	/** How many `verified` entries by actors other than the current one. */
	readonly otherAttestations: number;
	/** Whether the concept's human verification still binds its content (`none` when nobody human verified it). */
	readonly integrity: IntegrityState;
	/** Whether the concept is past its `stale_after` (or otherwise stale) at the time the rows were selected. */
	readonly stale: boolean;
	/** The concept file's bundle-relative path (`concept.path`); the loaders in `run.ts` make it absolute. */
	readonly path: string;
	/**
	 * When `x-okfit-integrity.verified` was bound (ISO 8601), the time a drifted row's
	 * preview diff is measured from; `null` when nothing is bound.
	 */
	readonly boundAt: string | null;
}

const boundAtOf = (concept: LoadedConcept): string | null => {
	const at = concept.frontmatter.integrity?.verified?.at;
	return at === undefined ? null : DateTime.formatIso(at);
};

/**
 * Every concept whose type sets `require_verified` that `actor` has not
 * attested, plus every drifted concept of any type (a human verified it once
 * and its content has changed since, so the `verified-drift` lint sends the
 * reader here): drafts included, deprecated concepts and the actor's own
 * still-bound attestations excluded, unknown-status concepts too (a drifted one is offered again). Sorted
 * by type, then id; grouping is the caller's.
 *
 * @public
 */
export const selectPickerCandidates = (
	bundle: LoadedBundle,
	config: OkfitConfig,
	actor: string,
	signals: ReadonlyMap<string, ConceptSignal>,
): ReadonlyArray<PickerCandidate> => {
	const types = requireVerifiedTypes(config);
	const rows: Array<PickerCandidate> = [];
	for (const [id, concept] of bundle.concepts) {
		const { type, title, description } = concept.frontmatter;
		const status = Derive.status(concept.frontmatter);
		const drifted = signals.get(id)?.integrity === "drifted";
		if ((!types.has(type) && !drifted) || status === "deprecated" || status === "unknown") continue;
		const verified = concept.frontmatter.verified ?? [];
		if (attestedBy(concept, actor, signals)) continue;
		rows.push({
			id,
			type,
			status: status === "draft" ? "draft" : "stable",
			title: title ?? null,
			description: description ?? null,
			otherAttestations: verified.filter((entry) => entry.by !== actor).length,
			integrity: signals.get(id)?.integrity ?? "none",
			stale: signals.get(id)?.stale ?? false,
			path: concept.path,
			boundAt: boundAtOf(concept),
		});
	}
	return rows.toSorted((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/**
 * Issue #228: the picker rows for `okfit stale --verify`: one per stale item,
 * any type, deprecated concepts excluded. Unlike {@link selectPickerCandidates}
 * the actor's own attestation does not exclude a row, because re-attesting is
 * the point; `otherAttestations` still counts only other actors. Sorted by
 * type, then id.
 *
 * @public
 */
export const selectStaleCandidates = (
	bundle: LoadedBundle,
	items: ReadonlyArray<StaleConcept>,
	actor: string,
	signals: ReadonlyMap<string, ConceptSignal>,
): ReadonlyArray<PickerCandidate> => {
	const rows: Array<PickerCandidate> = [];
	for (const item of items) {
		const concept = bundle.concepts.get(item.id);
		if (concept === undefined) continue;
		const { type, title, description } = concept.frontmatter;
		const status = Derive.status(concept.frontmatter);
		if (status === "deprecated" || status === "unknown") continue;
		rows.push({
			id: item.id,
			type,
			status: status === "draft" ? "draft" : "stable",
			title: title ?? null,
			description: description ?? null,
			otherAttestations: (concept.frontmatter.verified ?? []).filter((entry) => entry.by !== actor).length,
			integrity: signals.get(item.id)?.integrity ?? "none",
			stale: signals.get(item.id)?.stale ?? false,
			path: concept.path,
			boundAt: boundAtOf(concept),
		});
	}
	return rows.toSorted((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

/**
 * The batch type-resolution rule shared by `runVerifyBatch` and any future
 * interactive picker: explicit `types` must each be declared in
 * `config.types` (else `VerifySelectionError` with reason `unknown-type`);
 * an empty `types` selects every declared type whose `require_verified` is
 * `true`.
 *
 * @public
 */
export const resolveBatchTypes = (
	config: OkfitConfig,
	types: ReadonlyArray<string>,
): Effect.Effect<ReadonlySet<string>, VerifySelectionError> => {
	const declared = config.types ?? {};
	if (types.length === 0) {
		return Effect.succeed(requireVerifiedTypes(config));
	}
	for (const type of types) {
		if (!Object.hasOwn(declared, type))
			return Effect.fail(new VerifySelectionError({ reason: "unknown-type", detail: type }));
	}
	return Effect.succeed(new Set(types));
};
