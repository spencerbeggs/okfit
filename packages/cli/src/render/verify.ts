import type { Document } from "@effected/cli";
import { Doc } from "@effected/cli";
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
	return (lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines).map((line) => `  ${line}`);
};

const statusSuffixOf = (status: VerifyLines["status"]): string =>
	status === null
		? ""
		: status.from === status.to
			? `; status already ${status.to}`
			: `; status ${status.from ?? "(absent)"} -> ${status.to}`;

/** A fragment as a `Doc.verbatim` block: indented two spaces, never wrapped, trailing newline dropped (I3). */
const fragmentBlock = (fragment: string) => Doc.verbatim(indentFragment(fragment).join("\n"));

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
	const statusSuffix = statusSuffixOf(input.status);
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

const paragraphs = (lines: ReadonlyArray<string>): Document => lines.map((text) => Doc.paragraph(text));

/**
 * The `Doc` form of {@link humanVerify}: each fact line a paragraph, each
 * `--dry-run` fragment a `Doc.verbatim` block (indented, never wrapped, so a
 * YAML block keeps its shape). Plain output is byte-identical to
 * `humanVerify(input).join("\n")`.
 *
 * @public
 */
export const humanVerifyDoc = (input: VerifyLines): Document => [
	...input.priorAt.map((at) => Doc.paragraph(`already verified by ${input.by} at ${at}; appending`)),
	Doc.paragraph(
		input.dryRun
			? `would verify ${input.id} by ${input.by} at ${input.at}${statusSuffixOf(input.status)} (dry run, nothing written)`
			: `verified ${input.id} by ${input.by} at ${input.at}${statusSuffixOf(input.status)}`,
	),
	...(input.dryRun ? [Doc.paragraph("would write:"), fragmentBlock(input.fragment)] : []),
	...(input.dryRun && input.statusFragment !== null
		? [Doc.paragraph("would set status:"), fragmentBlock(input.statusFragment)]
		: []),
];

/**
 * The `Doc` form of {@link humanVerifyBatch}; plain output is byte-identical
 * to `humanVerifyBatch(input).join("\n")`.
 *
 * @public
 */
export const humanVerifyBatchDoc = (input: VerifyBatchLines): Document => [
	...paragraphs(
		input.skipped.map((entry) =>
			entry.reason === "already-verified"
				? `skipped ${entry.id}: already verified by ${input.by}`
				: `skipped ${entry.id}: ${entry.reason}`,
		),
	),
	...input.verified.flatMap((entry) =>
		input.dryRun
			? [
					Doc.paragraph(`would verify ${entry.id} by ${input.by} at ${input.at}`),
					Doc.paragraph("would write:"),
					fragmentBlock(entry.fragment),
				]
			: [Doc.paragraph(`verified ${entry.id} by ${input.by} at ${input.at}`)],
	),
	Doc.paragraph(
		input.dryRun
			? `would verify ${input.verified.length}, skipped ${input.skipped.length} (dry run, nothing written)`
			: `verified ${input.verified.length}, skipped ${input.skipped.length}`,
	),
];
