/**
 * `registerInlayHints`: `textDocument/inlayHint` over the session's
 * last-loaded snapshot (LSP roadmap phase 5, task 5) -- answered from
 * whatever `edits.ts`'s `conceptSnapshot` last resolved, never a trigger or
 * a wait, the same posture as hover, navigation and code actions.
 *
 * Two inlay hints per concept, computed by the pure {@link hintsFor}: a
 * trust/staleness hint anchored on the `status` field's own value when the
 * frontmatter carries an explicit `status` key, else on `type`'s (every
 * concept has a `type`, so an absent `status` -- which `Derive.status`
 * silently defaults to `"stable"` -- still gets an anchor); and, only when
 * `generated.at` is present, a second hint giving its age in whole days.
 * Each hint's position is the *end* of its field's own value range
 * (`toLspRange(...).end`), so the label reads immediately after the value.
 * When `DiagnosticRange.forFrontmatterPath` cannot locate the named leaf and
 * falls back to the whole frontmatter block (a flow-mapping document none of
 * its per-key lookups can enter), that field's hint is dropped rather than
 * mis-anchored at the block's own end -- detected by comparing the resolved
 * range against `forFrontmatterPath(document, [])`.
 *
 * @packageDocumentation
 */
import type { Concept } from "@okfit/core";
import { Actor, Derive, DiagnosticRange } from "@okfit/core";
import type { DateTime } from "effect";
import { DateTime as DateTimeService, Effect, Option } from "effect";
import { toLspRange } from "../convert/range.js";
import { uriToPath } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { InlayHint, InlayHintParams } from "../protocol/types.js";
import { INLAY_HINT_KIND_TYPE } from "../protocol/types.js";
import type { SessionRegistryShape } from "../session/registry.js";
import { conceptSnapshot } from "./edits.js";

/** One frontmatter leaf an inlay hint can anchor on. @public */
export type InlayHintPath = readonly ["status"] | readonly ["type"] | readonly ["generated", "at"];

/** One inlay hint {@link hintsFor} computed, before its position is resolved against a document. @public */
export interface InlayHintSpec {
	readonly path: InlayHintPath;
	readonly label: string;
}

const STATUS_PATH: InlayHintPath = ["status"];
const TYPE_PATH: InlayHintPath = ["type"];
const GENERATED_AT_PATH: InlayHintPath = ["generated", "at"];

/** `human-reviewed by <by>` for the newest `verified[]` entry whose `by` starts with `human:` (greatest `at`). */
const newestHumanBy = (concept: Concept): string => {
	const humans = (concept.verified ?? []).filter((entry) => Actor.isHuman(entry.by));
	const newest = humans.reduce((latest, entry) =>
		DateTimeService.toEpochMillis(entry.at) > DateTimeService.toEpochMillis(latest.at) ? entry : latest,
	);
	return newest.by;
};

/** `unverified` | `machine-confirmed` | `human-reviewed by <by>` (the newest human entry), plus ` · stale` when `Derive.isStale`. */
const trustLabel = (concept: Concept, now: DateTime.Utc): string => {
	const tier = Derive.trustTier(concept);
	const base =
		tier === "unverified"
			? "unverified"
			: tier === "machine-confirmed"
				? "machine-confirmed"
				: `human-reviewed by ${newestHumanBy(concept)}`;
	return Derive.isStale(concept, now) ? `${base} · stale` : base;
};

/** `generated.at`'s age against `now`: `today` under one whole day, `1 day ago`, else `N days ago` -- whole days, floored. */
const ageLabel = (at: DateTime.Utc, now: DateTime.Utc): string => {
	const millis = DateTimeService.toEpochMillis(now) - DateTimeService.toEpochMillis(at);
	const days = Math.floor(millis / 86_400_000);
	if (days <= 0) return "today";
	if (days === 1) return "1 day ago";
	return `${days} days ago`;
};

/**
 * The inlay hints for `concept`'s frontmatter against `now`: the trust/
 * staleness hint (anchored on `status` when the frontmatter carries an
 * explicit `status` key, else on `type`), and, only when `generated.at` is
 * set, a second hint giving its age. Pure -- no session or document needed,
 * tested directly.
 *
 * @public
 */
export const hintsFor = (concept: Concept, now: DateTime.Utc): ReadonlyArray<InlayHintSpec> => {
	const hints: Array<InlayHintSpec> = [
		{ path: concept.status === undefined ? TYPE_PATH : STATUS_PATH, label: trustLabel(concept, now) },
	];
	if (concept.generated?.at !== undefined) {
		hints.push({ path: GENERATED_AT_PATH, label: ageLabel(concept.generated.at, now) });
	}
	return hints;
};

/** Whether `range` is `forFrontmatterPath`'s fallback-to-whole-block answer for an unlocatable leaf (same offset and length as `whole`). */
const isFallback = (range: DiagnosticRange, whole: DiagnosticRange | undefined): boolean =>
	whole !== undefined && range.offset === whole.offset && range.length === whole.length;

/**
 * Wires `textDocument/inlayHint` onto `transport`, answering from
 * `registry`'s last-loaded snapshot via `edits.ts`'s `conceptSnapshot`. A
 * missing session, an unloaded bundle, a non-`file:` URI, or a path outside
 * every bundle root all answer `[]` -- never a hang, same posture as hover,
 * navigation and code actions. See the file header for the hint set and
 * anchoring.
 *
 * @public
 */
export const registerInlayHints = (transport: LspTransportShape, registry: SessionRegistryShape): Effect.Effect<void> =>
	transport.onRequest<InlayHintParams, ReadonlyArray<InlayHint>>("textDocument/inlayHint", (params) =>
		Effect.gen(function* () {
			const path = uriToPath(params.textDocument.uri);
			if (Option.isNone(path)) return [];
			const snapshot = yield* conceptSnapshot(registry, path.value);
			if (Option.isNone(snapshot)) return [];
			const { concept } = snapshot.value;
			const now = yield* DateTimeService.now;
			const source = concept.document.source;
			const whole = DiagnosticRange.forFrontmatterPath(concept.document, []);

			const hints: Array<InlayHint> = [];
			for (const spec of hintsFor(concept.frontmatter, now)) {
				const range = DiagnosticRange.forFrontmatterPath(concept.document, spec.path);
				if (range === undefined || isFallback(range, whole)) continue;
				hints.push({
					position: toLspRange(source, range).end,
					label: spec.label,
					kind: INLAY_HINT_KIND_TYPE,
					paddingLeft: true,
				});
			}
			return hints;
		}),
	);
