import { Schema } from "effect";

/**
 * V-11's success envelope, schema 1, snake_case — the same convention as
 * `render/json.ts`'s `JsonEnvelope`. Identical in shape for a dry run,
 * which sets `dry_run: true` and still exits 0. There is no content tier,
 * so `exit_code` is the literal `0`; a failure produces K-22's
 * `JsonErrorEnvelope` instead, unchanged.
 *
 * @public
 */
export const VerifyEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	id: Schema.String,
	path: Schema.String,
	verified: Schema.Struct({ by: Schema.String, at: Schema.String }),
	dry_run: Schema.Boolean,
	exit_code: Schema.Literal(0),
});
/** @public */
export type VerifyEnvelope = typeof VerifyEnvelope.Type;

/**
 * `path` is already the display form — `displayRoot(cwd, bundle.root, path)`
 * joined to the bundle-relative `concept.path` — because `LoadedConcept.path`
 * alone would print `decisions/cli-exit-codes.md`, not
 * `okf/decisions/cli-exit-codes.md` (contract §12 note 5).
 *
 * @public
 */
export const verifyEnvelope = (input: {
	readonly okfitVersion: string;
	readonly id: string;
	readonly path: string;
	readonly by: string;
	readonly at: string;
	readonly dryRun: boolean;
}): VerifyEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	id: input.id,
	path: input.path,
	verified: { by: input.by, at: input.at },
	dry_run: input.dryRun,
	exit_code: 0,
});
