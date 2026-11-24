import type { LoadedBundle, LoadedConcept } from "@okfit/core";
import { ConceptId, Diagnostic, DiagnosticRange, OkfitConfig } from "@okfit/core";
import type { PlatformError } from "effect";
import { Effect, Option } from "effect";
import type { Digest } from "effect/crypto";
import { Derivation } from "./Derivation.js";

/**
 * The concept type name of a documentation surface.
 *
 * @public
 */
export const SURFACE_TYPE = "Surface" as const;

/**
 * The concept type name of a published page rendered from bundle concepts.
 *
 * @public
 */
export const PUBLICATION_TYPE = "Publication" as const;

/**
 * One entry of a Publication's `renders` list, with its position.
 *
 * @public
 */
export interface RendersEntry {
	readonly index: number;
	readonly path: string;
	readonly body?: string;
}

const stripSuffixes = (raw: string): string => {
	const hash = raw.indexOf("#");
	const noFragment = hash < 0 ? raw : raw.slice(0, hash);
	const query = noFragment.indexOf("?");
	return query < 0 ? noFragment : noFragment.slice(0, query);
};

const percentDecode = (raw: string): string => {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
};

// OKF v0.3 section 6: a leading `/` resolves from the bundle root, anything else from the referencing file's directory.
// The same rule core's link resolver applies (`internal/links.ts`), minus its existence lookups and v0.2 root fallback.
const resolveRef = (from: string, raw: string): string => {
	const target = percentDecode(stripSuffixes(raw.trim()));
	const segments = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
	for (const part of target.replace(/\.md$/u, "").split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (segments.length === 0) return "";
			segments.pop();
			continue;
		}
		segments.push(part);
	}
	return segments.join("/");
};

const rendersOf = (concept: LoadedConcept): ReadonlyArray<RendersEntry> | undefined => {
	const value = concept.frontmatter.raw.renders;
	if (!Array.isArray(value)) return undefined;
	const out: Array<RendersEntry> = [];
	for (const [index, entry] of value.entries()) {
		if (typeof entry !== "object" || entry === null || typeof entry.path !== "string") return undefined;
		const current = typeof entry.body === "string" && entry.body !== "" ? entry.body : undefined;
		const legacy =
			typeof entry.body_sha256 === "string" && entry.body_sha256 !== "" ? entry.body_sha256.slice(0, 16) : undefined;
		const digest = current ?? legacy;
		out.push(digest === undefined ? { index, path: entry.path } : { index, path: entry.path, body: digest });
	}
	return out;
};

const compare = (a: Diagnostic, b: Diagnostic): number =>
	a.file < b.file ? -1 : a.file > b.file ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

/**
 * A profiles-owned lint over Publication concepts: `publication-orphan` when a
 * `surface` or `renders[].path` does not resolve to a bundle concept (or
 * `renders` is malformed), and `publication-drift` when a rendered source's
 * body digest no longer matches the stamped `renders[].body`. Total over
 * severity: returns `[]` before any digest work when both codes are `"off"`.
 *
 * @public
 */
export class Publications {
	private constructor() {}

	/**
	 * Resolves a raw reference against a bundle-relative concept path (a leading `/` from the bundle root); `""` when it escapes the bundle.
	 * Unlike core's resolver it does not treat a URL as external (a URL yields no concept and is reported as an orphan), and it knowingly
	 * differs in having no legacy root fallback for a bare value, and in `/` alone and a climb above the root both yielding no concept.
	 */
	static readonly resolveRef: (from: string, raw: string) => string = resolveRef;

	/** The `renders` entries of a Publication, or `undefined` when malformed. */
	static readonly rendersOf: (concept: LoadedConcept) => ReadonlyArray<RendersEntry> | undefined = rendersOf;

	/** Lints every Publication in `bundle`; diagnostics are sorted by file then code. */
	static readonly lint: (
		bundle: LoadedBundle,
		config: OkfitConfig,
	) => Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, Digest.Digest> = Effect.fn(
		"Publications.lint",
	)(function* (bundle: LoadedBundle, config: OkfitConfig) {
		const driftSeverity = OkfitConfig.severityFor(config, "publication-drift");
		const orphanSeverity = OkfitConfig.severityFor(config, "publication-orphan");
		if (driftSeverity === "off" && orphanSeverity === "off") return [];
		const diagnostics: Array<Diagnostic> = [];
		const push = (
			concept: LoadedConcept,
			code: "publication-drift" | "publication-orphan",
			severity: "error" | "warning" | "info",
			message: string,
			path: ReadonlyArray<string | number>,
		): void => {
			const range = DiagnosticRange.forFrontmatterPath(concept.document, path);
			diagnostics.push(
				Diagnostic.make({ file: concept.path, code, severity, message, ...(range === undefined ? {} : { range }) }),
			);
		};
		for (const [id, concept] of bundle.concepts) {
			if (concept.frontmatter.type !== PUBLICATION_TYPE) continue;
			const resource = String(concept.frontmatter.raw.resource ?? concept.path);
			if (orphanSeverity !== "off") {
				const surface = concept.frontmatter.raw.surface;
				// An absent surface is `required-key-missing`'s to report.
				if (surface !== undefined) {
					const target =
						typeof surface === "string"
							? Option.match(ConceptId.normalize(resolveRef(concept.path, surface)), {
									onNone: () => undefined,
									onSome: (key) => bundle.concepts.get(key),
								})
							: undefined;
					if (target === undefined) {
						push(
							concept,
							"publication-orphan",
							orphanSeverity,
							`surface ${JSON.stringify(surface)} does not resolve to a concept in the bundle`,
							["surface"],
						);
					} else if (target.frontmatter.type !== SURFACE_TYPE) {
						push(
							concept,
							"publication-orphan",
							orphanSeverity,
							`surface ${JSON.stringify(surface)} resolves to a concept of type ${JSON.stringify(target.frontmatter.type)}, not ${SURFACE_TYPE}`,
							["surface"],
						);
					}
				}
			}
			const renders = rendersOf(concept);
			if (renders === undefined) {
				if (orphanSeverity !== "off") {
					push(concept, "publication-orphan", orphanSeverity, "renders must be a list of { path, body } entries", [
						"renders",
					]);
				}
				continue;
			}
			if (renders.length === 0) {
				if (orphanSeverity !== "off") {
					push(concept, "publication-orphan", orphanSeverity, "renders must name at least one source", ["renders"]);
				}
				continue;
			}
			const stale: Array<string> = [];
			for (const entry of renders) {
				const sourceId = resolveRef(concept.path, entry.path);
				const source = Option.match(ConceptId.normalize(sourceId), {
					onNone: () => undefined,
					onSome: (key) => bundle.concepts.get(key),
				});
				if (source === undefined) {
					if (orphanSeverity !== "off") {
						push(
							concept,
							"publication-orphan",
							orphanSeverity,
							`renders[${entry.index}].path ${JSON.stringify(entry.path)} does not resolve to a concept in the bundle`,
							["renders", entry.index, "path"],
						);
					}
					continue;
				}
				if (driftSeverity === "off") continue;
				if (entry.body === undefined) {
					stale.push(`${sourceId} (never stamped)`);
					continue;
				}
				const current = yield* Derivation.bodyDigest(source.document.source);
				if (current !== entry.body) stale.push(`${sourceId} (changed)`);
			}
			if (stale.length > 0 && driftSeverity !== "off") {
				push(
					concept,
					"publication-drift",
					driftSeverity,
					`Rendered page ${resource} is stale against: ${stale.join(", ")}; re-render it, then run okfit sync --publication ${id}`,
					["renders"],
				);
			}
		}
		return diagnostics.sort(compare);
	});
}
