import type { Document } from "@effected/cli";
import { Doc } from "@effected/cli";

/** `humanMoveDoc`'s input shape. @public */
export interface MoveLines {
	readonly from: string;
	readonly to: string;
	readonly edits: ReadonlyArray<{ readonly path: string; readonly count: number }>;
	readonly drifts: ReadonlyArray<string>;
	readonly dryRun: boolean;
}

const fact = (text: string) => Doc.line(text, { wrap: false });

/**
 * `okfit mv`'s human output: a headline, one line per rewritten file, the concepts that now need a
 * human to re-verify them, and the next step.
 *
 * @public
 */
export const humanMoveDoc = (input: MoveLines): Document => {
	const lines = [
		input.dryRun ? `would move ${input.from} -> ${input.to}; nothing written` : `moved ${input.from} -> ${input.to}`,
		...input.edits.map(
			(edit) =>
				`  ${input.dryRun ? "would rewrite" : "rewrote"} ${edit.path} (${edit.count} ${edit.count === 1 ? "reference" : "references"})`,
		),
		...(input.drifts.length > 0 ? [`will drift (a human re-verifies): ${input.drifts.join(", ")}`] : []),
		"next: okfit sync",
	];
	return lines.map(fact);
};
