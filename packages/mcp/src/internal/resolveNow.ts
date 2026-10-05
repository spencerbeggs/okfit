import { ToolRefusal } from "@effected/mcp";
import { Timestamp } from "@okfit/core";
import { DateTime, Effect, Schema } from "effect";

/**
 * An optional ISO-8601 `now` argument, else the Effect clock. Decoding
 * happens here rather than in the parameter schema so a malformed value
 * becomes this contract's `ToolRefusal` — with a remediation hint —
 * instead of Effect's generic protocol-level `InvalidParams` (J-5).
 * `OKFIT_NOW` is deliberately NOT read: it is the CLI's own test hook
 * (F-17), never the server's.
 *
 * @internal
 */
export const resolveNow = (input: string | undefined): Effect.Effect<DateTime.Utc, ToolRefusal> =>
	input === undefined
		? DateTime.now
		: Schema.decodeUnknownEffect(Timestamp)(input).pipe(
				Effect.mapError((issue) => {
					const remediation = {
						hint: "now must be an ISO-8601 instant with an explicit offset, for example 2026-09-06T00:00:00Z.",
					};
					return ToolRefusal.refuse(String(issue), remediation);
				}),
			);
