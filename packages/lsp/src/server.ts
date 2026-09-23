/**
 * `serve`: the okfit language server program over an {@link LspTransportShape}.
 *
 * @packageDocumentation
 */
import type { Distribution } from "@okfit/engine";
import type { Duration, Scope } from "effect";
import { Cause, Deferred, Effect, Exit, Option, Queue } from "effect";
import { uriToPath } from "./convert/uri.js";
import { notifyBundleChanged, registerConcepts } from "./features/concepts.js";
import { makeDiagnosticsFeature, makeRevalidatePublisher } from "./features/diagnostics.js";
import { registerDocumentSync } from "./features/documentSync.js";
import { registerHover } from "./features/hover.js";
import { OKFIT_CODE_ACTION_KINDS, OKFIT_COMMANDS } from "./features/names.js";
import { registerNavigation } from "./features/navigation.js";
import { registerWorkspaceSymbols } from "./features/symbols.js";
import type { ListenOutcome, LspTransportShape } from "./protocol/LspTransport.js";
import type {
	DidChangeWatchedFilesParams,
	DidChangeWorkspaceFoldersParams,
	InitializeParams,
	InitializeResult,
} from "./protocol/types.js";
import type { SessionRegistryServices } from "./session/registry.js";
import { makeSessionRegistry } from "./session/registry.js";
import { LSP_VERSION } from "./version.js";

/**
 * Options for {@link serve}.
 *
 * @public
 */
export interface ServeOptions {
	/** The revalidate debounce; default `"150 millis"`. */
	readonly delay?: Duration.Input;
	/**
	 * Upper bound on how long a steady stream of edits can defer a
	 * revalidate; default `"1 second"`. See `SchedulerOptions.maxWait`
	 * (`session/scheduler.ts`).
	 */
	readonly maxWait?: Duration.Input;
	/** The distribution embedding this server, named in the startup log line. */
	readonly distribution?: Distribution;
}

/**
 * Every service {@link serve} needs: exactly the session registry's.
 *
 * @public
 */
export type ServeServices = SessionRegistryServices;

/** Absolute paths of the `file:` URIs in `uris`; any other URI is dropped. */
const pathsOf = (uris: ReadonlyArray<string>): ReadonlyArray<string> =>
	uris.flatMap((uri) => Option.toArray(uriToPath(uri)));

/** The workspace folders `initialize` names: `workspaceFolders` when the client sent it, else `rootUri`. */
const initialFolders = (params: InitializeParams): ReadonlyArray<string> => {
	if (params.workspaceFolders !== null && params.workspaceFolders !== undefined) {
		return pathsOf(params.workspaceFolders.map((folder) => folder.uri));
	}
	return params.rootUri === null ? [] : pathsOf([params.rootUri]);
};

const INITIALIZE_RESULT: InitializeResult = {
	capabilities: {
		// TextDocumentSyncKind.Full is 1; the enum lives in the library, which features never import.
		textDocumentSync: { openClose: true, change: 1, save: true },
		workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
		documentLinkProvider: { resolveProvider: false },
		definitionProvider: true,
		referencesProvider: true,
		hoverProvider: true,
		workspaceSymbolProvider: true,
		codeActionProvider: { codeActionKinds: [...OKFIT_CODE_ACTION_KINDS] },
		executeCommandProvider: { commands: [...OKFIT_COMMANDS] },
		inlayHintProvider: true,
		experimental: { okfitConcepts: true },
	},
	serverInfo: { name: "okfit-lsp", version: LSP_VERSION },
};

/**
 * Wires lifecycle, sync and diagnostics onto the transport, then listens.
 *
 * Every notification handler enqueues its work on one queue that a single
 * fiber drains in order, so document events and workspace-folder changes
 * apply in the order the client sent them even though the transport runs
 * each handler on its own fiber. A defect in one unit of work is logged and
 * the queue keeps draining. `shutdown` first waits for the queue to drain
 * up to its own arrival, then for every session's scheduler to settle, so
 * work the client sent before `shutdown` is revalidated and published
 * before the response.
 *
 * @public
 */
export const serve = (
	transport: LspTransportShape,
	options?: ServeOptions,
): Effect.Effect<ListenOutcome, never, ServeServices | Scope.Scope> =>
	Effect.gen(function* () {
		const delay = options?.delay ?? "150 millis";
		const maxWait = options?.maxWait ?? "1 second";
		const distribution = options?.distribution;

		const publisher = yield* makeRevalidatePublisher(transport);
		const registry = yield* makeSessionRegistry({
			delay,
			maxWait,
			onRevalidate: (handle, tier) =>
				Effect.andThen(
					publisher.publish(handle, tier),
					notifyBundleChanged(transport, handle.bundleRoot, "revalidated"),
				),
			onDispose: (handle) =>
				Effect.andThen(
					publisher.clear(handle.bundleRoot),
					notifyBundleChanged(transport, handle.bundleRoot, "dropped"),
				),
		});
		const feature = yield* makeDiagnosticsFeature(registry);

		const work = yield* Queue.unbounded<Effect.Effect<void>>();
		yield* Effect.forkScoped(
			Effect.forever(
				Effect.gen(function* () {
					const next = yield* Queue.take(work);
					const exit = yield* Effect.exit(next);
					if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
						yield* Effect.logWarning(`okfit-lsp: a notification handler failed: ${Cause.pretty(exit.cause)}`);
					}
				}),
			),
		);
		const enqueue = (effect: Effect.Effect<void>): Effect.Effect<void> => Effect.asVoid(Queue.offer(work, effect));

		yield* transport.onInitialize((params) =>
			Effect.as(registry.setFolders(initialFolders(params)), INITIALIZE_RESULT),
		);
		yield* transport.onInitialized(() =>
			Effect.logInfo(
				distribution === undefined
					? `okfit-lsp ${LSP_VERSION}`
					: `okfit-lsp ${LSP_VERSION} via ${distribution.name} ${distribution.version}`,
			),
		);
		yield* transport.onNotification<DidChangeWorkspaceFoldersParams>(
			"workspace/didChangeWorkspaceFolders",
			({ event }) =>
				enqueue(
					Effect.gen(function* () {
						yield* registry.removeFolders(pathsOf(event.removed.map((folder) => folder.uri)));
						yield* registry.addFolders(pathsOf(event.added.map((folder) => folder.uri)));
					}),
				),
		);
		yield* transport.onNotification<DidChangeWatchedFilesParams>("workspace/didChangeWatchedFiles", ({ changes }) =>
			enqueue(feature.onWatchedFiles(pathsOf(changes.map((change) => change.uri)))),
		);
		yield* registerDocumentSync(transport, (event) => enqueue(feature.onDocumentEvent(event)));
		yield* registerNavigation(transport, registry);
		yield* registerHover(transport, registry);
		yield* registerWorkspaceSymbols(transport, registry);
		yield* registerConcepts(transport, registry);
		yield* transport.onShutdown(() =>
			Effect.gen(function* () {
				// A marker unit: once it runs, every unit queued before shutdown has run and scheduled its revalidate.
				const drained = yield* Deferred.make<void>();
				yield* enqueue(Deferred.succeed(drained, undefined));
				yield* Deferred.await(drained);
				const handles = yield* registry.sessions;
				yield* Effect.forEach(handles, (handle) => handle.scheduler.settle, { discard: true });
			}),
		);

		return yield* transport.listen;
	});
