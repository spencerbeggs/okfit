import type { LoadedBundle, LoadedConcept } from "@okfit/core";

/**
 * Why a candidate concept was skipped by batch selection: `"draft"` and
 * `"deprecated"` mirror `status`, `"already-verified"` means the actor already
 * carries a `verified` entry.
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
 * Issue #138/#143: which concepts of `types` the actor may attest in one
 * batch. A draft is unsettled and a deprecated concept is retired (#143), so
 * both are skipped before the already-verified check.
 *
 * @public
 */
export const selectAttestable = (
	bundle: LoadedBundle,
	types: ReadonlySet<string>,
	actor: string,
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
		if ((concept.frontmatter.verified ?? []).some((entry) => entry.by === actor)) {
			skipped.push({ id, reason: "already-verified" });
			continue;
		}
		candidates.push(concept);
	}
	return { candidates, skipped };
};
