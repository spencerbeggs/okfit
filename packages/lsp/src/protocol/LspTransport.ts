import type { Effect } from "effect";
import { Context } from "effect";
import type { LspError } from "../errors.js";
import type { InitializeParams, InitializeResult } from "./types.js";

/**
 * How a connection ended, as `LspTransportShape.listen` reports it.
 *
 * @public
 */
export interface ListenOutcome {
	/**
	 * "exit": the client sent the `exit` notification. "closed": the input
	 * stream ended first, and every message already buffered on it (if
	 * any) was still fully decoded, dispatched, and its handler settled
	 * before this was reported -- a client that batches a whole
	 * conversation into one write and closes its output in the same tick
	 * never silently loses it. If that batch's tail was `exit`, the
	 * outcome is always `"exit"`, never `"closed"`.
	 */
	readonly reason: "exit" | "closed";
	/** Whether a `shutdown` request arrived before the connection ended. */
	readonly shutdownReceived: boolean;
}

/**
 * The transport seam: the only protocol surface features code against. A
 * transport never exits the process; `listen` resolves with a
 * {@link ListenOutcome} and the caller decides the exit code.
 *
 * Every registration may be made before or after `listen` starts. Registering
 * a second handler for the same method replaces the first.
 *
 * @public
 */
export interface LspTransportShape {
	/** Registers the `initialize` request handler; its failure becomes a JSON-RPC error with the `LspError` code. */
	readonly onInitialize: (
		handler: (params: InitializeParams) => Effect.Effect<InitializeResult, LspError>,
	) => Effect.Effect<void>;
	/** Registers the `initialized` notification handler. */
	readonly onInitialized: (handler: () => Effect.Effect<void>) => Effect.Effect<void>;
	/** Registers the `shutdown` request handler; it runs before the transport answers `shutdown`. */
	readonly onShutdown: (handler: () => Effect.Effect<void>) => Effect.Effect<void>;
	/** Registers a request handler for `method`; an `LspError` failure is answered as a JSON-RPC error with its code and message. */
	readonly onRequest: <P, R>(method: string, handler: (params: P) => Effect.Effect<R, LspError>) => Effect.Effect<void>;
	/** Registers a notification handler for `method`. A defect is reported to the client as a `window/logMessage` error. */
	readonly onNotification: <P>(method: string, handler: (params: P) => Effect.Effect<void>) => Effect.Effect<void>;
	/** Sends a notification to the client. A send on a closed connection is dropped. */
	readonly sendNotification: <P>(method: string, params: P) => Effect.Effect<void>;
	/** Sends a request to the client; a JSON-RPC error answer fails with an `LspError` carrying its code. */
	readonly sendRequest: <P, R>(method: string, params: P) => Effect.Effect<R, LspError>;
	/** Starts reading; resolves when the connection ends. Call once. */
	readonly listen: Effect.Effect<ListenOutcome>;
}

/**
 * The service tag for the transport seam.
 *
 * @public
 */
export class LspTransport extends Context.Service<LspTransport, LspTransportShape>()("@okfit/lsp/LspTransport") {}
