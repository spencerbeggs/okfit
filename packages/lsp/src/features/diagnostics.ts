/**
 * Diagnostics publishing: document events and watched-file changes schedule a
 * debounced whole-bundle revalidate, and each revalidate publishes one
 * `textDocument/publishDiagnostics` per file whose diagnostics changed.
 *
 * @packageDocumentation
 */
import type { RevalidateTier } from "@okfit/engine";
import { DateTime, Effect, Option, Path, Result } from "effect";
import { sourceTextOf, toLspDiagnostic } from "../convert/diagnostic.js";
import { pathToUri } from "../convert/uri.js";
import { messageOf } from "../internal/messageOf.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { OpenDocuments } from "../session/documents.js";
import { makeDocumentMemory } from "../session/documents.js";
import type { SessionHandle, SessionRegistryShape } from "../session/registry.js";
import type { DocumentEvent } from "./documentSync.js";

/**
 * The diagnostics feature a server wires onto document sync and
 * `workspace/didChangeWatchedFiles`.
 *
 * @public
 */
export interface DiagnosticsFeature {
	/** Updates the owning session's overlay and open-document memory, then schedules a revalidate; a document outside every bundle root is ignored. */
	readonly onDocumentEvent: (event: DocumentEvent) => Effect.Effect<void>;
	/**
	 * Absolute paths; a config file change rebuilds its bundle root's session
	 * once, however many workspace folders share it (the old one's
	 * diagnostics are cleared by the registry's `onDispose`), carries every
	 * open document the new session owns into it, and
	 * schedules a full revalidate on it -- a config that fails to load again
	 * is retried later exactly as before. Anything else schedules a full
	 * revalidate on every live session. A folder whose config failed is
	 * retried when a path under it changes, and a full revalidate is
	 * scheduled if it now builds.
	 */
	readonly onWatchedFiles: (paths: ReadonlyArray<string>) => Effect.Effect<void>;
	/** The open-document memory `onDocumentEvent` records into: each open buffer's current text and version, for the features that compute edits against it. */
	readonly documents: OpenDocuments;
}

/**
 * The registry's scheduler callback: read now, revalidate, publish every
 * changed file.
 *
 * @public
 */
export type RevalidatePublisher = (handle: SessionHandle, tier: RevalidateTier) => Effect.Effect<void>;

/**
 * `makeRevalidatePublisher`'s result: the `RevalidatePublisher` a
 * `SessionRegistry` calls back into as `onRevalidate`, plus `clear` for its
 * `onDispose`.
 *
 * @public
 */
export interface DiagnosticsPublisher {
	readonly publish: RevalidatePublisher;
	/** Publishes `[]` for every URI `root`'s session last published non-empty, then forgets `root`. A root with nothing remembered is a no-op. */
	readonly clear: (root: string) => Effect.Effect<void>;
}

/**
 * Builds a `DiagnosticsPublisher` a `SessionRegistry` is constructed
 * with (`publish` as `onRevalidate`, `clear` composed into `onDispose`). Per
 * session root, remembers the URIs last published non-empty -- added when a
 * publish's diagnostics are non-empty, dropped when they are `[]` -- so
 * `clear` knows exactly what to take back. A bundle-level diagnostic
 * (engine file `""`) publishes against the bundle root's `index.md` and is
 * remembered under that URI like any other. A failed revalidate logs a
 * warning and publishes nothing. Built before the registry, since the
 * registry needs `publish`/`clear` as constructor options and `clear` must
 * already exist for the registry's `onDispose` to close over.
 *
 * @public
 */
export const makeRevalidatePublisher = (
	transport: LspTransportShape,
): Effect.Effect<DiagnosticsPublisher, never, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		// Mutated only from synchronous, no-yield-point blocks (`remember`, `clear`'s read), so concurrent
		// publishes for different bundle roots never interleave a read with a write.
		const remembered = new Map<string, Set<string>>();

		const remember = (root: string, uri: string, isEmpty: boolean): void => {
			const current = remembered.get(root) ?? new Set<string>();
			if (isEmpty) current.delete(uri);
			else current.add(uri);
			if (current.size === 0) remembered.delete(root);
			else remembered.set(root, current);
		};

		const publish: RevalidatePublisher = (handle, tier) =>
			Effect.gen(function* () {
				const now = yield* DateTime.now;
				const result = yield* Effect.result(handle.session.revalidate({ now, tier }));
				if (Result.isFailure(result)) {
					yield* Effect.logWarning(
						`okfit-lsp: revalidate failed for ${handle.bundleRoot}: ${messageOf(result.failure)}`,
					);
					return;
				}
				const { changed, bundle } = result.success;
				yield* Effect.forEach(
					changed,
					([file, diagnostics]) => {
						const target = file === "" ? path.join(handle.bundleRoot, "index.md") : path.join(handle.bundleRoot, file);
						const uri = pathToUri(target);
						const text = sourceTextOf(bundle, file);
						const isEmpty = diagnostics.length === 0;
						// Uninterruptible as one unit: the send must land before `remember` is updated, or a
						// `Scope.close` (a rebuild/dispose) interrupting this fiber between the two could delete a
						// URI from the remembered set without the client ever having received the `[]` that
						// justified the deletion -- `clear` would then never re-send it, leaving the client with a
						// stale diagnostic forever. `Effect.uninterruptible` defers that interrupt until this
						// per-file step (send, then remember) has completed.
						return Effect.uninterruptible(
							Effect.gen(function* () {
								yield* transport.sendNotification("textDocument/publishDiagnostics", {
									uri,
									diagnostics: diagnostics.map((diagnostic) => toLspDiagnostic(diagnostic, text)),
								});
								remember(handle.bundleRoot, uri, isEmpty);
							}),
						);
					},
					{ discard: true },
				);
			});

		const clear = (root: string): Effect.Effect<void> => {
			const uris = remembered.get(root);
			remembered.delete(root);
			if (uris === undefined || uris.size === 0) return Effect.void;
			return Effect.forEach(
				[...uris],
				(uri) => transport.sendNotification("textDocument/publishDiagnostics", { uri, diagnostics: [] }),
				{ discard: true },
			);
		};

		return { publish, clear };
	});

/**
 * Builds a {@link DiagnosticsFeature} over `registry`. Open and save
 * schedule the `full` tier, change and close the `edit` tier. Open and save
 * also retry a folder whose config failed to load. Open-document memory
 * (`session/documents.ts`) is registry-wide, not per-folder: ownership of a
 * path shifts with the workspace folder set, and `onWatchedFiles` filters it
 * by the rebuilt session's bundle root at the moment it needs it.
 *
 * @public
 */
export const makeDiagnosticsFeature = (registry: SessionRegistryShape): Effect.Effect<DiagnosticsFeature> =>
	Effect.gen(function* () {
		const documents = yield* makeDocumentMemory();

		const onDocumentEvent = (event: DocumentEvent): Effect.Effect<void> =>
			Effect.gen(function* () {
				// The full-tier triggers retry a folder whose config failed, so fixing the config and saving recovers it.
				const retryFailed = event.kind === "open" || event.kind === "save";
				const owner = yield* registry.sessionFor(event.path, { retryFailed });
				if (Option.isNone(owner)) return;
				const { session, scheduler } = owner.value;
				switch (event.kind) {
					case "open":
						yield* session.open(event.path, event.text, event.version);
						yield* documents.record(event.path, event.text, event.version);
						return yield* scheduler.schedule("full");
					case "change":
						yield* session.change(event.path, event.text, event.version);
						yield* documents.record(event.path, event.text, event.version);
						return yield* scheduler.schedule("edit");
					case "save":
						return yield* scheduler.schedule("full");
					case "close":
						yield* session.close(event.path);
						yield* documents.forget(event.path);
						return yield* scheduler.schedule("edit");
				}
			});

		const onWatchedFiles = (paths: ReadonlyArray<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				// One handle per bundle root, however many workspace folders share it, so a config change
				// rebuilds each root exactly once; distinct roots are independent (their own entry, scheduler
				// and publisher memory), so one root's rebuild (I/O) never waits behind another's.
				const handles = yield* registry.sessions;
				yield* Effect.forEach(
					handles,
					(handle) =>
						Effect.gen(function* () {
							const { configChanged } = yield* handle.session.watchedFilesChanged(paths);
							if (!configChanged) {
								yield* handle.scheduler.schedule("full");
								return;
							}
							const rebuilt = yield* registry.rebuild(handle.bundleRoot);
							yield* Effect.forEach(
								rebuilt,
								(newHandle) =>
									Effect.gen(function* () {
										const overlays = yield* documents.openUnder(newHandle.bundleRoot);
										yield* Effect.forEach(
											overlays,
											([documentPath, document]) =>
												newHandle.session.open(documentPath, document.text, document.version),
											{ discard: true },
										);
										yield* newHandle.scheduler.schedule("full");
									}),
								{ discard: true },
							);
						}),
					{ concurrency: "unbounded", discard: true },
				);
				const recovered = yield* registry.retryFailed(paths);
				yield* Effect.forEach(recovered, (handle) => handle.scheduler.schedule("full"), { discard: true });
			});

		return { onDocumentEvent, onWatchedFiles, documents };
	});
