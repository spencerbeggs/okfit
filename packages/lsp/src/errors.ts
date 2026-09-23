import { Schema } from "effect";

/**
 * The one failure a request handler may return. `code` is a JSON-RPC error
 * code (`-32600` invalid request, `-32601` method not found, `-32602`
 * invalid params, `-32603` internal, `-32803` request failed); the
 * reference transport turns it into a `ResponseError`. Notifications
 * cannot fail: they log and return.
 *
 * @public
 */
export class LspError extends Schema.TaggedError<LspError>()("LspError", {
	code: Schema.Number,
	message: Schema.String,
}) {}
