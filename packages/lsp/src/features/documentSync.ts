/**
 * The four `textDocument/did*` notifications as {@link DocumentEvent}s.
 *
 * @packageDocumentation
 */
import { Effect, Option } from "effect";
import { uriToPath } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type {
	DidChangeTextDocumentParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	DidSaveTextDocumentParams,
} from "../protocol/types.js";

/**
 * One document-sync notification, with its `file:` URI already converted to
 * an absolute path. `change` carries the whole document (Full sync).
 *
 * @public
 */
export type DocumentEvent =
	| { readonly kind: "open"; readonly path: string; readonly text: string; readonly version: number }
	| { readonly kind: "change"; readonly path: string; readonly text: string; readonly version: number }
	| { readonly kind: "save"; readonly path: string }
	| { readonly kind: "close"; readonly path: string };

/** `onEvent(make(path))` for a `file:` URI; nothing for any other scheme or a malformed URI. */
const forPath = (
	uri: string,
	onEvent: (event: DocumentEvent) => Effect.Effect<void>,
	make: (path: string) => DocumentEvent,
): Effect.Effect<void> =>
	Option.match(uriToPath(uri), { onNone: () => Effect.void, onSome: (path) => onEvent(make(path)) });

/**
 * Registers the four textDocument/did* handlers; non-file URIs are dropped.
 * A `didChange` uses its last content change (Full sync sends exactly one
 * whole-document change); one with no content changes is ignored.
 *
 * @public
 */
export const registerDocumentSync = (
	transport: LspTransportShape,
	onEvent: (event: DocumentEvent) => Effect.Effect<void>,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		yield* transport.onNotification<DidOpenTextDocumentParams>("textDocument/didOpen", ({ textDocument }) =>
			forPath(textDocument.uri, onEvent, (path) => ({
				kind: "open",
				path,
				text: textDocument.text,
				version: textDocument.version,
			})),
		);
		yield* transport.onNotification<DidChangeTextDocumentParams>(
			"textDocument/didChange",
			({ textDocument, contentChanges }) => {
				const last = contentChanges.at(-1);
				if (last === undefined) return Effect.void;
				return forPath(textDocument.uri, onEvent, (path) => ({
					kind: "change",
					path,
					text: last.text,
					version: textDocument.version,
				}));
			},
		);
		yield* transport.onNotification<DidSaveTextDocumentParams>("textDocument/didSave", ({ textDocument }) =>
			forPath(textDocument.uri, onEvent, (path) => ({ kind: "save", path })),
		);
		yield* transport.onNotification<DidCloseTextDocumentParams>("textDocument/didClose", ({ textDocument }) =>
			forPath(textDocument.uri, onEvent, (path) => ({ kind: "close", path })),
		);
	});
