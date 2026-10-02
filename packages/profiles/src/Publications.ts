import type { LoadedBundle, LoadedConcept } from "@okfit/core";
import { Diagnostic, DiagnosticRange, OkfitConfig } from "@okfit/core";
import type { Crypto, PlatformError } from "effect";
import { Effect } from "effect";
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
	readonly body_sha256?: string;
}

const resolveRef = (from: string, raw: string): string => {
	const segments = from.split("/").slice(0, -1);
	for (const part of raw.replace(/\.md$/u, "").split("/")) {
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
		const digest = typeof entry.body_sha256 === "string" && entry.body_sha256 !== "" ? entry.body_sha256 : undefined;
		out.push(digest === undefined ? { index, path: entry.path } : { index, path: entry.path, body_sha256: digest });
	}
	return out;
};

const compare = (a: Diagnostic, b: Diagnostic): number =>
	a.file < b.file ? -1 : a.file > b.file ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0;

/**
 * A profiles-owned lint over Publication concepts: `publication-orphan` when a
 * `surface` or `renders[].path` does not resolve to a bundle concept (or
 * `renders` is malformed), and `publication-drift` when a rendered source's
 * body digest no longer matches the stamped `body_sha256`. Total over
 * severity: returns `[]` before any digest work when both codes are `"off"`.
 *
 * @public
 */
export class Publications {
	private constructor() {}

	/** Resolves a raw reference against a bundle-relative concept path; `""` when it escapes the bundle. */
	static readonly resolveRef: (from: string, raw: string) => string = resolveRef;

	/** The `renders` entries of a Publication, or `undefined` when malformed. */
	static readonly rendersOf: (concept: LoadedConcept) => ReadonlyArray<RendersEntry> | undefined = rendersOf;

	static readonly lint: (
		bundle: LoadedBundle,
		config: OkfitConfig,
	) => Effect.Effect<ReadonlyArray<Diagnostic>, PlatformError.PlatformError, Crypto.Crypto> = Effect.fn(
		"Publications.lint",
	)(function* (bundle: LoadedBundle, config: OkfitConfig) {
		const driftSeverity = OkfitConfig.severityFor(config, "publication-drift");
		const orphanSeverity = OkfitConfig.severityFor(config, "publication-orphan");
		if (driftSeverity === "off" && orphanSeverity === "off") return [];
		const diagnostics: Array<Diagnostic> = [];
		const exists = (id: string): boolean => id !== "" && [...bundle.concepts.keys()].some((key) => key === id);
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
				if (typeof surface !== "string" || !exists(resolveRef(concept.path, surface))) {
					push(
						concept,
						"publication-orphan",
						orphanSeverity,
						`surface ${JSON.stringify(surface)} does not resolve to a concept in the bundle`,
						["surface"],
					);
				}
			}
			const renders = rendersOf(concept);
			if (renders === undefined) {
				if (orphanSeverity !== "off") {
					push(
						concept,
						"publication-orphan",
						orphanSeverity,
						"renders must be a list of { path, body_sha256 } entries",
						["renders"],
					);
				}
				continue;
			}
			const stale: Array<string> = [];
			for (const entry of renders) {
				const sourceId = resolveRef(concept.path, entry.path);
				const source = sourceId === "" ? undefined : bundle.concepts.get(sourceId as typeof id);
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
				if (entry.body_sha256 === undefined) {
					stale.push(`${sourceId} (never stamped)`);
					continue;
				}
				const current = yield* Derivation.bodyDigest(source.document.source);
				if (current !== entry.body_sha256) stale.push(`${sourceId} (changed)`);
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
