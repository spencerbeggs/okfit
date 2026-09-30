import type { LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Effect } from "effect";
import { VerifySelectionError } from "../errors.js";

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
		return Effect.succeed(
			new Set(Object.entries(declared).flatMap(([name, spec]) => (spec.require_verified === true ? [name] : []))),
		);
	}
	for (const type of types) {
		if (!Object.hasOwn(declared, type))
			return Effect.fail(new VerifySelectionError({ reason: "unknown-type", detail: type }));
	}
	return Effect.succeed(new Set(types));
};
