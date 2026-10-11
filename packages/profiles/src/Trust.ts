import type { Actor, LoadedBundle, LoadedConcept, TrustTier, Verification } from "@okfit/core";
import { Actor as ActorNS, Derive, Diagnostic, DiagnosticRange, OkfitConfig, Timestamp } from "@okfit/core";
import type { Crypto, PlatformError } from "effect";
import { DateTime, Effect, Schema } from "effect";
import { Derivation } from "./Derivation.js";

const encodeAt = Schema.encodeSync(Timestamp);

/**
 * Whether a concept's human verification still covers its content: `none` (no
 * `human:` entry in `verified`), `current` (the latest human entry is bound by
 * `integrity.verified` and the content digest still matches), or `drifted`.
 *
 * @public
 */
export type IntegrityState = "current" | "drifted" | "none";

/**
 * Why a human verification no longer binds: the content changed, the entry has
 * no `integrity.verified` binding, or a later human entry is not the bound one.
 *
 * @public
 */
export type DriftReason = "content-changed" | "unbound" | "entry-superseded";

/**
 * The trust signal for one concept: its tier, whether its human verification
 * still binds, and staleness. `drift` is present only when `integrity` is
 * `drifted`.
 *
 * @public
 */
export interface ConceptSignal {
	readonly tier: TrustTier;
	readonly integrity: IntegrityState;
	readonly drift?: { readonly reason: DriftReason; readonly editedBy?: Actor; readonly editedAt?: string };
	readonly stale: boolean;
}

/** Only `human:` entries bind; machine entries neither bind nor break a binding. */
const latestHuman = (concept: LoadedConcept): Verification | undefined =>
	(concept.frontmatter.verified ?? [])
		.filter((entry) => ActorNS.isHuman(entry.by))
		.reduce<Verification | undefined>(
			(latest, entry) =>
				latest === undefined || DateTime.isGreaterThanOrEqualTo(entry.at, latest.at) ? entry : latest,
			undefined,
		);

const signal = Effect.fn("Trust.signal")(function* (concept: LoadedConcept, now: DateTime.Utc) {
	const tier = Derive.trustTier(concept.frontmatter);
	const stale = Derive.isStale(concept.frontmatter, now);
	const latest = latestHuman(concept);
	if (latest === undefined) return { tier, integrity: "none" as const, stale };
	const binding = concept.frontmatter.integrity?.verified;
	const drifted = (drift: NonNullable<ConceptSignal["drift"]>): ConceptSignal => ({
		tier,
		integrity: "drifted",
		drift,
		stale,
	});
	if (binding === undefined) return drifted({ reason: "unbound" });
	if (binding.by !== latest.by || !DateTime.Equivalence(binding.at, latest.at)) {
		return drifted({ reason: "entry-superseded" });
	}
	const content = yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
	if (content === binding.content) return { tier, integrity: "current" as const, stale };
	const generated = concept.frontmatter.generated;
	const edited =
		generated?.at !== undefined && DateTime.isGreaterThan(generated.at, binding.at)
			? { editedBy: generated.by, editedAt: encodeAt(generated.at) }
			: {};
	return drifted({ reason: "content-changed", ...edited });
});

const signals = Effect.fn("Trust.signals")(function* (bundle: LoadedBundle, now: DateTime.Utc) {
	const out = new Map<string, ConceptSignal>();
	for (const [id, concept] of bundle.concepts) out.set(id, yield* signal(concept, now));
	return out;
});

const messageFor = (concept: LoadedConcept, drift: NonNullable<ConceptSignal["drift"]>): string => {
	const latest = latestHuman(concept);
	const by = latest?.by ?? "a human";
	const at = latest === undefined ? "an unknown time" : encodeAt(latest.at);
	if (drift.reason === "unbound") {
		return `verified by ${by} at ${at}, but no integrity.verified binding records what was verified; re-run okfit verify`;
	}
	if (drift.reason === "entry-superseded") {
		return `the latest human verification (${by} at ${at}) is not the one integrity.verified binds; re-run okfit verify`;
	}
	const binding = concept.frontmatter.integrity?.verified;
	const edited = drift.editedBy === undefined ? "" : ` (edited by ${drift.editedBy} at ${drift.editedAt})`;
	return `content changed since ${binding?.by ?? by} verified it at ${binding === undefined ? at : encodeAt(binding.at)}${edited}; re-run okfit verify`;
};

/**
 * Where a `verified-drift` finding points (spec section 6): the binding when one exists,
 * else the latest human `verified` entry -- by its list index when `verified` is a
 * sequence, the key itself when it is a single bare mapping.
 */
const rangePath = (concept: LoadedConcept): ReadonlyArray<string | number> => {
	if (concept.frontmatter.integrity?.verified !== undefined) return ["integrity", "verified"];
	const latest = latestHuman(concept);
	const index = latest === undefined ? -1 : (concept.frontmatter.verified ?? []).indexOf(latest);
	return Array.isArray(concept.frontmatter.raw.verified) && index >= 0 ? ["verified", index] : ["verified"];
};

const lint = Effect.fn("Trust.lint")(function* (bundle: LoadedBundle, config: OkfitConfig, now: DateTime.Utc) {
	const severity = OkfitConfig.severityFor(config, "verified-drift");
	if (severity === "off") return [];
	const diagnostics: Array<Diagnostic> = [];
	for (const [, concept] of bundle.concepts) {
		const result = yield* signal(concept, now);
		if (result.drift === undefined) continue;
		const range = DiagnosticRange.forFrontmatterPath(concept.document, rangePath(concept));
		diagnostics.push(
			Diagnostic.make({
				file: concept.path,
				code: "verified-drift",
				severity,
				message: messageFor(concept, result.drift),
				...(range === undefined ? {} : { range }),
			}),
		);
	}
	return diagnostics;
});

/**
 * The integrity trust signal: whether a human verification still binds the
 * content it covered, and the `verified-drift` lint built on it. A signal, not
 * a tamper seal. Named `Trust` so it does not collide with core's `Integrity`
 * schema.
 *
 * @public
 */
export class Trust {
	private constructor() {}
	/** The signal for one concept; hashes only when a human entry is bound. */
	static readonly signal: (
		concept: LoadedConcept,
		now: DateTime.Utc,
	) => Effect.Effect<ConceptSignal, PlatformError.PlatformError, Crypto.Crypto> = signal;
	/** The signal for every concept in a bundle, keyed by concept id. */
	static readonly signals: (
		bundle: LoadedBundle,
		now: DateTime.Utc,
	) => Effect.Effect<Map<string, ConceptSignal>, PlatformError.PlatformError, Crypto.Crypto> = signals;
	/** `verified-drift` diagnostics for drifted concepts; `[]` (no hashing) when the severity is `off`. */
	static readonly lint: (
		bundle: LoadedBundle,
		config: OkfitConfig,
		now: DateTime.Utc,
	) => Effect.Effect<Array<Diagnostic>, PlatformError.PlatformError, Crypto.Crypto> = lint;
}
