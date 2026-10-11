import type { LoadedBundle, LoadedConcept, OkfitConfig, StaleConcept } from "@okfit/core";
import type { ConceptSignal, IntegrityState } from "@okfit/profiles";
import { Effect } from "effect";
import { VerifySelectionError } from "../errors.js";

/**
 * Why a candidate concept was skipped by batch selection: `"draft"` and
 * `"deprecated"` mirror `status`, `"already-verified"` means the actor's
 * `verified` entry is still bound to the concept's current content.
 *
 * @public
 */
export type VerifyBatchSkipReason = "draft" | "deprecated" | "already-verified";

/**
 * The outcome of {@link selectAttestable}.
 *
 * @public
 */
export interface AttestableSelection {
	/** In bundle iteration order. */
	readonly candidates: ReadonlyArray<LoadedConcept>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: VerifyBatchSkipReason }>;
}

/**
 * Whether `concept` is verified by `actor` AND that verification still binds
 * its content: the signal is `current` and `integrity.verified` names `actor`.
 * A drifted concept, or one whose current binding is another actor's, is not.
 */
const attestedBy = (concept: LoadedConcept, actor: string, signals: ReadonlyMap<string, ConceptSignal>): boolean =>
	signals.get(concept.id)?.integrity === "current" && concept.frontmatter.integrity?.verified?.by === actor;

/**
 * Issue #138/#143: which concepts of `types` the actor may attest in one
 * batch. A draft is unsettled and a deprecated concept is retired (#143), so
 * both are skipped before the already-verified check. A concept whose
 * verification has drifted, or is bound to another actor, is a candidate.
 *
 * @public
 */
export const selectAttestable = (
	bundle: LoadedBundle,
	types: ReadonlySet<string>,
	actor: string,
	signals: ReadonlyMap<string, ConceptSignal>,
): AttestableSelection => {
	const candidates: Array<LoadedConcept> = [];
	const skipped: Array<{ readonly id: string; readonly reason: VerifyBatchSkipReason }> = [];
	for (const [id, concept] of bundle.concepts) {
		if (!types.has(concept.frontmatter.type)) continue;
		const status = concept.frontmatter.status;
		if (status === "draft" || status === "deprecated") {
			skipped.push({ id, reason: status });
			continue;
		}
		if (attestedBy(concept, actor, signals)) {
			skipped.push({ id, reason: "already-verified" });
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
}

/**
 * Every concept whose type sets `require_verified` that `actor` has not
 * attested: drafts included, deprecated concepts and the actor's own still-bound
 * attestations excluded (a drifted one is offered again). Sorted by type, then id; grouping is the caller's.
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
		const { type, status, title, description } = concept.frontmatter;
		if (!types.has(type) || status === "deprecated") continue;
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
		const { type, status, title, description } = concept.frontmatter;
		if (status === "deprecated") continue;
		rows.push({
			id: item.id,
			type,
			status: status === "draft" ? "draft" : "stable",
			title: title ?? null,
			description: description ?? null,
			otherAttestations: (concept.frontmatter.verified ?? []).filter((entry) => entry.by !== actor).length,
			integrity: signals.get(item.id)?.integrity ?? "none",
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
