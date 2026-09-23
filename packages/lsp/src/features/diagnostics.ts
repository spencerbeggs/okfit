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
import type { SessionHandle, SessionRegistryShape } from "../session/registry.js";
import type { DocumentEvent } from "./documentSync.js";

/**
 * The diagnostics feature a server wires onto document sync and
 * `workspace/didChangeWatchedFiles`.
 *
 * @public
 */
export interface DiagnosticsFeature {
	/** Updates the owning session's overlay and schedules a revalidate; a document outside every bundle root is ignored. */
	readonly onDocumentEvent: (event: DocumentEvent) => Effect.Effect<void>;
	/** Absolute paths; a config file change invalidates its folder's session, anything else schedules a full revalidate. */
	readonly onWatchedFiles: (paths: ReadonlyArray<string>) => Effect.Effect<void>;
}

/** The registry's scheduler callback: read now, revalidate, publish every changed file. */
export type RevalidatePublisher = (handle: SessionHandle, tier: RevalidateTier) => Effect.Effect<void>;

/**
 * Builds the {@link RevalidatePublisher} a `SessionRegistry` calls back into.
 * A bundle-level diagnostic (engine file `""`) publishes against the bundle
 * root's `index.md`. A failed revalidate logs a warning and publishes
 * nothing. Built before the registry, since the registry needs it as its
 * `onRevalidate` option.
 *
 * @public
 */
export const makeRevalidatePublisher = (
	transport: LspTransportShape,
): Effect.Effect<RevalidatePublisher, never, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;

		return (handle: SessionHandle, tier: RevalidateTier): Effect.Effect<void> =>
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
						const text = sourceTextOf(bundle, file);
						return transport.sendNotification("textDocument/publishDiagnostics", {
							uri: pathToUri(target),
							diagnostics: diagnostics.map((diagnostic) => toLspDiagnostic(diagnostic, text)),
						});
					},
					{ discard: true },
				);
			});
	});

/**
 * Builds a {@link DiagnosticsFeature} over `registry`. Open and save
 * schedule the `full` tier, change and close the `edit` tier.
 *
 * @public
 */
export const makeDiagnosticsFeature = (registry: SessionRegistryShape): Effect.Effect<DiagnosticsFeature> =>
	Effect.sync(() => {
		const onDocumentEvent = (event: DocumentEvent): Effect.Effect<void> =>
			Effect.gen(function* () {
				const owner = yield* registry.sessionFor(event.path);
				if (Option.isNone(owner)) return;
				const { session, scheduler } = owner.value;
				switch (event.kind) {
					case "open":
						yield* session.open(event.path, event.text, event.version);
						return yield* scheduler.schedule("full");
					case "change":
						yield* session.change(event.path, event.text, event.version);
						return yield* scheduler.schedule("edit");
					case "save":
						return yield* scheduler.schedule("full");
					case "close":
						yield* session.close(event.path);
						return yield* scheduler.schedule("edit");
				}
			});

		const onWatchedFiles = (paths: ReadonlyArray<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const handles = yield* registry.sessions;
				yield* Effect.forEach(
					handles,
					(handle) =>
						Effect.gen(function* () {
							const { configChanged } = yield* handle.session.watchedFilesChanged(paths);
							if (configChanged) yield* registry.invalidate(handle.folder);
							else yield* handle.scheduler.schedule("full");
						}),
					{ discard: true },
				);
			});

		return { onDocumentEvent, onWatchedFiles };
	});
