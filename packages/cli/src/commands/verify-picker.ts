import { Cancelled, CliInteractive } from "@effected/cli";
import { CliUi, Confirm, MultiSelect } from "@effected/cli/ui";
import type { OkfitConfig } from "@okfit/core";
import type { PickerCandidate } from "@okfit/engine";
import { loadPickerCandidates, loadPreviews } from "@okfit/engine";
import { Console, Effect } from "effect";

/** What the picker decided: attest exactly these ids, and settle drafts when `promote`. */
export interface PickedConcepts {
	readonly by: string;
	readonly ids: ReadonlyArray<string>;
	readonly promote: boolean;
}

/**
 * Where {@link pickConcepts} gets its rows, and what it says about them.
 *
 * @public
 */
export interface PickerSource {
	readonly load: ReturnType<typeof loadPickerCandidates>;
	/** The line printed when `load` yields no rows. */
	readonly empty: (by: string) => string;
	/** The list screen's title. */
	readonly message: string;
}

/** One compact row: id, status, how many other actors already attested it, then `drifted` (its verification no longer binds) and `stale` markers. */
export const pickerLabel = (candidate: PickerCandidate): string => {
	const base =
		candidate.otherAttestations === 0
			? `${candidate.id}  ${candidate.status}`
			: `${candidate.id}  ${candidate.status}  ${candidate.otherAttestations} other attestation(s)`;
	const markers = [...(candidate.integrity === "drifted" ? ["drifted"] : []), ...(candidate.stale ? ["stale"] : [])];
	return markers.length === 0 ? base : `${base}  ${markers.join("  ")}`;
};

const detailOf = (candidate: PickerCandidate): string | undefined => {
	const { title, description } = candidate;
	if (title !== null && description !== null) return `${title} — ${description}`;
	return title ?? description ?? undefined;
};

/** Candidates grouped into one section per type, in candidate order. */
export const pickerSections = (candidates: ReadonlyArray<PickerCandidate>) => {
	const byType = new Map<string, Array<PickerCandidate>>();
	for (const candidate of candidates) {
		const rows = byType.get(candidate.type);
		if (rows === undefined) byType.set(candidate.type, [candidate]);
		else rows.push(candidate);
	}
	return [...byType].map(([type, rows]) => ({
		title: type,
		items: rows.map((candidate) => {
			const detail = detailOf(candidate);
			return {
				key: candidate.id,
				label: pickerLabel(candidate),
				value: candidate.id,
				...(detail === undefined ? {} : { detail }),
			};
		}),
	}));
};

/**
 * The picker with a diff preview pane, for a list holding a drifted row. The
 * previews are read before the screen mounts (git runs no process while a frame
 * is drawn), and only when the run is interactive, since otherwise the prompt
 * fails `NotInteractive` without mounting. The screen's module, and with it
 * React and Ink, loads only when it mounts.
 */
const previewPrompt = (
	message: string,
	sections: ReturnType<typeof pickerSections>,
	candidates: ReadonlyArray<PickerCandidate>,
) =>
	Effect.gen(function* () {
		const previews = (yield* CliInteractive) ? yield* loadPreviews(candidates) : new Map();
		return yield* CliUi.prompt(
			CliUi.lazy(() =>
				import("./verify-preview.js").then((module) => ({
					default: module.previewScreen({ message, sections, candidates, previews }),
				})),
			),
		);
	});

/**
 * Bare `okfit verify` on a terminal: list what `by` has not attested, let the
 * person pick, confirm. When a row is drifted the list gains a preview pane
 * showing the highlighted row's diff since its verification was bound. Resolves to `undefined` (after printing why) when there
 * is nothing to do; fails `Cancelled` on Esc, `q`, Ctrl-C or a "no" answer, and
 * `NotInteractive` when no screen can mount. Writes nothing itself.
 */
export const pickConcepts = (
	options: {
		readonly bundleRoot: string;
		readonly projectRoot: string;
		readonly config: OkfitConfig;
	},
	// Issue #228: `okfit stale --verify` swaps in the stale set, its own empty
	// line and its own title; bare `verify` passes nothing and is unchanged.
	source: PickerSource = {
		load: loadPickerCandidates(options),
		empty: (by) => `nothing to verify: every require_verified concept is already attested by ${by}`,
		message: "Attest which concepts?",
	},
) =>
	Effect.gen(function* () {
		const { by, candidates } = yield* source.load;
		if (candidates.length === 0) {
			yield* Console.log(source.empty(by));
			return undefined;
		}
		const sections = pickerSections(candidates);
		// A drifted row gets the diff preview screen; with none, the stock list, unchanged.
		const ids = candidates.some((candidate) => candidate.integrity === "drifted")
			? yield* previewPrompt(source.message, sections, candidates)
			: yield* CliUi.prompt(MultiSelect.screen({ message: source.message, sections }));
		if (ids.length === 0) {
			yield* Console.log("nothing selected; nothing written");
			return undefined;
		}
		const chosen = new Set(ids);
		const drafts = candidates.filter((candidate) => chosen.has(candidate.id) && candidate.status === "draft").length;
		const answer = yield* CliUi.prompt(
			Confirm.screen({
				message: `Attest ${ids.length} concept(s) as ${by}?`,
				initial: true,
				toggles: drafts > 0 ? [{ key: "promote", label: `promote ${drafts} draft(s) to stable`, value: true }] : [],
			}),
		);
		if (!answer.confirmed) return yield* new Cancelled({ reason: "escape" });
		return { by, ids, promote: answer.toggles.promote ?? false } satisfies PickedConcepts;
	});
