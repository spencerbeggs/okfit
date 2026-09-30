import type { VerifyBatchSkipReason } from "@okfit/engine";
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
	/** Issue #185: the status change requested, or `null` when no status flag was given. */
	readonly status: { readonly from: string | null; readonly to: string } | null;
	/** The exact status bytes a real run would splice in; printed only when `dryRun`. */
	readonly statusFragment: string | null;
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
export const humanVerify = (input: VerifyLines): ReadonlyArray<string> => {
	const statusSuffix =
		input.status === null
			? ""
			: input.status.from === input.status.to
				? `; status already ${input.status.to}`
				: `; status ${input.status.from ?? "(absent)"} -> ${input.status.to}`;
	return [
		...input.priorAt.map((at) => `already verified by ${input.by} at ${at}; appending`),
		input.dryRun
			? `would verify ${input.id} by ${input.by} at ${input.at}${statusSuffix} (dry run, nothing written)`
			: `verified ${input.id} by ${input.by} at ${input.at}${statusSuffix}`,
		...(input.dryRun ? ["would write:", ...indentFragment(input.fragment)] : []),
		...(input.dryRun && input.statusFragment !== null
			? ["would set status:", ...indentFragment(input.statusFragment)]
			: []),
	];
};

/** Issue #138: `humanVerifyBatch`'s input shape. @public */
export interface VerifyBatchLines {
	readonly by: string;
	readonly at: string;
	readonly dryRun: boolean;
	readonly verified: ReadonlyArray<{ readonly id: string; readonly fragment: string }>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: VerifyBatchSkipReason }>;
}

/**
 * V-11-at-batch-scale (#138): one line per skipped candidate, then one line
 * (or, under `--dry-run`, three) per verified concept, then a trailing tally.
 *
 * @public
 */
export const humanVerifyBatch = (input: VerifyBatchLines): ReadonlyArray<string> => [
	...input.skipped.map((entry) =>
		entry.reason === "already-verified"
			? `skipped ${entry.id}: already verified by ${input.by}`
			: `skipped ${entry.id}: ${entry.reason}`,
	),
	...input.verified.flatMap((entry) =>
		input.dryRun
			? [`would verify ${entry.id} by ${input.by} at ${input.at}`, "would write:", ...indentFragment(entry.fragment)]
			: [`verified ${entry.id} by ${input.by} at ${input.at}`],
	),
	input.dryRun
		? `would verify ${input.verified.length}, skipped ${input.skipped.length} (dry run, nothing written)`
		: `verified ${input.verified.length}, skipped ${input.skipped.length}`,
];
