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

/** @public */
export interface VerifyLines {
	readonly id: string;
	readonly by: string;
	readonly at: string;
	/** Every prior entry by the SAME actor, in list order (V-2). */
	readonly priorAt: ReadonlyArray<string>;
	readonly dryRun: boolean;
	/** The exact bytes a real run would splice in; printed only when `dryRun`. */
	readonly fragment: string;
}

/**
 * Indent every line of `fragment` two spaces for display under a
 * `would write:` header, dropping the single trailing empty line a
 * newline-terminated fragment produces on split (I3).
 */
const indentFragment = (fragment: string): ReadonlyArray<string> => {
	const lines = fragment.split(/\r\n|\n/);
	const trimmed = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
	return trimmed.map((line) => `  ${line}`);
};

/**
 * V-11's human output: one line per fact. One `already verified` line per
 * prior entry by the same actor, in list order (V-2 says "entries",
 * plural), then the success line. A prior entry by a DIFFERENT actor is
 * not called out: it stays on disk untouched (V-1) and is simply not this
 * line's subject. Under `--dry-run` (I3), a `would write:` header and the
 * exact fragment a real run would splice in follow, so the preview
 * exercises — and shows — the same edit the write path would make.
 *
 * @public
 */
export const humanVerify = (input: VerifyLines): ReadonlyArray<string> => [
	...input.priorAt.map((at) => `already verified by ${input.by} at ${at}; appending`),
	input.dryRun
		? `would verify ${input.id} by ${input.by} at ${input.at} (dry run, nothing written)`
		: `verified ${input.id} by ${input.by} at ${input.at}`,
	...(input.dryRun ? ["would write:", ...indentFragment(input.fragment)] : []),
];
