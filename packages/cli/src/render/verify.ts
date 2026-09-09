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
