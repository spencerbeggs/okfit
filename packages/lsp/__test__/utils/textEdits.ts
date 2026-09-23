import type { Position, TextEdit, WorkspaceEdit } from "../../src/protocol/types.js";

/** `position` as an offset into `text`, counting CRLF, CR and LF each as one line break (the inverse of `toLspRange`). */
const offsetOf = (text: string, position: Position): number => {
	let offset = 0;
	let line = 0;
	while (line < position.line && offset < text.length) {
		const code = text.charCodeAt(offset);
		if (code === 0x0d) {
			offset++;
			if (text.charCodeAt(offset) === 0x0a) offset++;
			line++;
		} else if (code === 0x0a) {
			offset++;
			line++;
		} else {
			offset++;
		}
	}
	const lineStart = offset;
	while (offset < text.length && offset - lineStart < position.character) {
		const code = text.charCodeAt(offset);
		if (code === 0x0d || code === 0x0a) break;
		offset++;
	}
	return offset;
};

/** `text` with one `TextEdit` (as `toLspRange` computed it) applied. */
export const applyTextEdit = (text: string, edit: TextEdit): string =>
	text.slice(0, offsetOf(text, edit.range.start)) + edit.newText + text.slice(offsetOf(text, edit.range.end));

/**
 * The one versioned document change `edit` carries for `uri`: its target
 * version and its single `TextEdit`. Throws when `edit` carries unversioned
 * `changes`, more or fewer than one document change, a change for another
 * URI, or more or fewer than one `TextEdit`.
 */
export const singleDocumentEdit = (
	edit: WorkspaceEdit | undefined,
	uri: string,
): { readonly version: number | null; readonly edit: TextEdit } => {
	if (edit?.changes !== undefined) throw new Error("expected documentChanges, got unversioned changes");
	const changes = edit?.documentChanges;
	if (changes === undefined || changes.length !== 1) throw new Error("expected exactly one document change");
	const change = changes[0];
	if (change === undefined || !("textDocument" in change) || !("edits" in change)) {
		throw new Error("expected a TextDocumentEdit");
	}
	if (change.textDocument.uri !== uri) throw new Error(`expected a change for ${uri}, got ${change.textDocument.uri}`);
	const [only, ...rest] = change.edits;
	if (only === undefined || rest.length > 0) throw new Error("expected exactly one TextEdit");
	return { version: change.textDocument.version, edit: only as TextEdit };
};
