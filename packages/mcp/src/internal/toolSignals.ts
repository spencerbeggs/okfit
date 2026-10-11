import { ToolRefusal } from "@effected/mcp";
import type { LoadedBundle } from "@okfit/core";
import type { ConceptSignal } from "@okfit/profiles";
import { Trust } from "@okfit/profiles";
import type { Crypto, DateTime } from "effect";
import { Effect } from "effect";
import { messageOf } from "./toolContext.js";

/**
 * `Trust.signals` with its platform failure (a concept file unreadable while
 * hashing) collapsed to the tools' one declared failure, a `ToolRefusal`.
 *
 * @internal
 */
export const toolSignals = (
	bundle: LoadedBundle,
	now: DateTime.Utc,
): Effect.Effect<Map<string, ConceptSignal>, ToolRefusal, Crypto.Crypto> =>
	Trust.signals(bundle, now).pipe(
		Effect.mapError((cause) =>
			ToolRefusal.refuse(messageOf(cause), {
				hint: "A concept file could not be read to check its verification; retry once the bundle is readable.",
			}),
		),
	);
