import { DateTime } from "effect";
import { Concept } from "../../src/Concept.js";
import type { Status } from "../../src/Status.js";

/** A `Note` concept with no typed fields and `raw` carrying `raw` beside the type (as an undecodable key leaves it). */
export const conceptWithRaw = (raw: Record<string, unknown>): Concept =>
	Concept.make({ type: "Note", extensions: {}, raw: { type: "Note", ...raw } });

/** A `Note` concept whose typed `status` is `status`. */
export const conceptWithStatus = (status: Status): Concept =>
	Concept.make({ type: "Note", extensions: {}, raw: { type: "Note", status }, status });

/** A `Note` concept whose typed `stale_after` is the instant `staleAfter`. */
export const conceptWithStaleAfter = (staleAfter: string): Concept =>
	Concept.make({
		type: "Note",
		extensions: {},
		raw: { type: "Note", stale_after: staleAfter },
		stale_after: DateTime.makeUnsafe(staleAfter),
	});
