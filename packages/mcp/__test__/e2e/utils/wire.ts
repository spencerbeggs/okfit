import type { McpProcess } from "@effected/mcp/testing";
import { Effect } from "effect";

/**
 * One JSON-RPC 2.0 error frame, as the wire sends it for a malformed or
 * non-JSON-RPC stdin line (`-32700`/`-32600`, both with `id: null`).
 */
interface JsonRpcErrorFrame {
	readonly jsonrpc: "2.0";
	readonly id: string | number | null;
	readonly error: { readonly code: number; readonly message: string };
}

const isJsonRpcErrorFrame = (value: unknown): value is JsonRpcErrorFrame =>
	typeof value === "object" &&
	value !== null &&
	"error" in value &&
	typeof (value as { error: unknown }).error === "object";

/**
 * Reads raw stdout lines from `server` until one is a JSON-RPC error frame
 * carrying `code`, skipping any interleaved notification along the way --
 * the same "read past what you don't want" posture `McpProcess.readUntilResponse`
 * uses for a response id, but keyed on an error code instead, since a
 * stdin-guard reply (`-32700`/`-32600`) carries `id: null` and can never be
 * matched by id.
 */
export const readUntilErrorCode = (server: McpProcess, code: number): Effect.Effect<JsonRpcErrorFrame, never> =>
	Effect.gen(function* () {
		while (true) {
			const line = yield* Effect.orDie(server.nextLine);
			const parsed: unknown = JSON.parse(line);
			if (isJsonRpcErrorFrame(parsed) && parsed.error.code === code) return parsed;
		}
	});
