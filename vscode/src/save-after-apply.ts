/** The slice of `vscode.TextDocument` {@link saveAfterApply} needs. */
export interface SaveableDocument {
	readonly isDirty: boolean;
	save(): PromiseLike<boolean>;
}

/**
 * What {@link saveAfterApply} did: `saved`, `skipped` (the edit was not
 * applied, or the document was already clean) or `failed` (the document
 * could not be opened or saved).
 */
export type SaveOutcome = "saved" | "skipped" | "failed";

/**
 * After the server's `workspace/applyEdit` for `okfit.setStatus` or
 * `okfit.markVerified` came back, save the edited document (#182). Only the
 * tree and palette commands call this: the user has no open editor there to
 * notice a dirty buffer, and a concept that was not open never becomes
 * visible to git otherwise. A lightbulb code action in an open editor is
 * applied by VS Code itself and stays dirty, like any quick fix.
 *
 * `open` resolves the document model for `uri`; for a concept that was not
 * open, VS Code already holds it (dirty) after `applyEdit`, so opening it
 * returns that same model. No vscode import here, so the decision is tested
 * with a fake. Never throws: a failure is reported as `failed`.
 */
export const saveAfterApply = async (
	result: { readonly applied: boolean },
	uri: string,
	open: (uri: string) => PromiseLike<SaveableDocument>,
): Promise<SaveOutcome> => {
	if (!result.applied) return "skipped";
	try {
		const document = await open(uri);
		if (!document.isDirty) return "skipped";
		return (await document.save()) ? "saved" : "failed";
	} catch {
		return "failed";
	}
};
