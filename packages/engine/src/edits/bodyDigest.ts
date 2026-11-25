import { MarkdownEdit } from "@effected/markdown";
import { Derivation } from "@okfit/profiles";
import { Effect } from "effect";
import { locateIntegrity, spliceIntegrityGenerated } from "../verify/integrity.js";
import { detectNewline } from "../verify/locate.js";

/**
 * What {@link rerecordBodyDigest} did: `untouched` (`text` is `after` as given), `rerecorded` (`text` carries the new
 * `x-okfit-integrity.generated.body`) or `unrecordable` (the integrity block has a layout that is never edited, so the
 * recorded digest is left stale in `text`, which is `after`).
 *
 * @internal
 */
export interface RerecordedBody {
	readonly text: string;
	readonly outcome: "untouched" | "rerecorded" | "unrecordable";
}

/**
 * Keep a concept's recorded body digest current after a writer changed its body (a link repair, a rename). `before` and
 * `after` are BOM-free texts. The digest is re-recorded only when it matched `before` (an already stale record stays
 * stale: a re-record would hide the drift) and `after`'s body digest differs from it. A layout the integrity splice
 * cannot edit, or a block that does not parse, is `unrecordable`: the text is returned as `after` and a digest is never
 * forged. Only `generated.body` changes; `generated.at`, `verified` and `x-okfit-integrity.verified` are left alone.
 *
 * @internal
 */
export const rerecordBodyDigest = Effect.fn("okfit/edits/rerecordBodyDigest")(function* (input: {
	readonly recorded: string | undefined;
	readonly before: string;
	readonly after: string;
}) {
	const { recorded, before, after } = input;
	const untouched = { text: after, outcome: "untouched" } as const satisfies RerecordedBody;
	if (recorded === undefined) return untouched;
	if (recorded !== (yield* Derivation.bodyDigest(before))) return untouched;
	const next = yield* Derivation.bodyDigest(after);
	if (next === recorded) return untouched;
	const located = yield* locateIntegrity(after).pipe(
		Effect.catchTag("YamlParseError", () => Effect.succeed(undefined)),
	);
	if (located === undefined || located._tag === "unsupported")
		return { text: after, outcome: "unrecordable" } as const satisfies RerecordedBody;
	return {
		text: MarkdownEdit.applyAll(after, [spliceIntegrityGenerated(located, after, next, detectNewline(after))]),
		outcome: "rerecorded",
	} as const satisfies RerecordedBody;
});
