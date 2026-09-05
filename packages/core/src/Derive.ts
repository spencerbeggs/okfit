import { DateTime, Schema } from "effect";
import { Actor } from "./Actor.js";
import type { LoadedBundle, LoadedConcept } from "./Bundle.js";
import type { Concept } from "./Concept.js";
import type { IndexEntryInput } from "./internal/templates.js";
import { indexEntry, indexFrontmatter, indexSection, logEntry } from "./internal/templates.js";
import type { Status } from "./Status.js";

/** Trust tier from `verified` (OKF 0.2 §5.3): none => unverified; only non-human => machine-confirmed; any `human:` => human-reviewed. @public */
export const TrustTier = Schema.Literals(["unverified", "machine-confirmed", "human-reviewed"]);

/** @public */
export type TrustTier = typeof TrustTier.Type;

/** Three-way staleness; `unknown` means no `stale_after`. @public */
export const Staleness = Schema.Literals(["fresh", "stale", "unknown"]);

/** @public */
export type Staleness = typeof Staleness.Type;

/** One dated `log.md` group to render. @public */
export interface LogEntry {
	readonly date: string;
	readonly items: ReadonlyArray<string>;
}

/** Options for {@link Derive.renderIndex}. @public */
export interface RenderIndexOptions {
	/** Emits `---\nokf_version: "<v>"\n---\n\n` first; root index only (D-21). */
	readonly okfVersion?: string;
	/** Rendered as `* [name](name/index.md)` under a trailing `# Subdirectories` section. */
	readonly subdirectories?: ReadonlyArray<string>;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const dirnameOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const relativeTarget = (dir: string, path: string): string =>
	dir !== "" && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;

/** Pure derivations (D-10, D-36): trust tier, status, staleness against a supplied instant, index/log rendering. @public */
export class Derive {
	private constructor() {}

	/** Any `human:` verifier => human-reviewed; otherwise machine-confirmed; none => unverified. */
	static readonly trustTier = (concept: Concept): TrustTier => {
		const verified = concept.verified ?? [];
		if (verified.length === 0) {
			return "unverified";
		}
		return verified.some((entry) => Actor.isHuman(entry.by)) ? "human-reviewed" : "machine-confirmed";
	};

	/** Absent `status` reads as `stable` (OKF 0.2 §5.4). */
	static readonly status = (concept: Concept): Status => concept.status ?? "stable";

	/** `stale` when `now >= stale_after` (OKF 0.2 §5.5); `unknown` without `stale_after`. */
	static readonly staleness = (concept: Concept, now: DateTime.Utc): Staleness => {
		if (concept.stale_after === undefined) {
			return "unknown";
		}
		return DateTime.toEpochMillis(now) >= DateTime.toEpochMillis(concept.stale_after) ? "stale" : "fresh";
	};

	/** Boolean form of {@link Derive.staleness} (D-36). */
	static readonly isStale = (concept: Concept, now: DateTime.Utc): boolean =>
		Derive.staleness(concept, now) === "stale";

	/** Frontmatter `title`, else the file name without `.md` (OKF 0.2 §4.1). */
	static readonly title = (concept: LoadedConcept): string =>
		concept.frontmatter.title ?? basename(concept.path).replace(/\.md$/, "");

	/** One H1 per `type` (sorted), entries sorted by title, then `# Subdirectories` (D-36; spec §8). */
	static readonly renderIndex = (
		dir: string,
		concepts: ReadonlyArray<LoadedConcept>,
		options: RenderIndexOptions = {},
	): string => {
		const groups = new Map<string, Array<IndexEntryInput>>();
		for (const concept of concepts) {
			const entries = groups.get(concept.frontmatter.type) ?? [];
			const description = concept.frontmatter.description;
			entries.push({
				title: Derive.title(concept),
				target: relativeTarget(dir, concept.path),
				...(description === undefined ? {} : { description: oneLine(description) }),
			});
			groups.set(concept.frontmatter.type, entries);
		}
		const sections = [...groups.keys()].sort(compare).map((type) => {
			const entries = (groups.get(type) ?? []).sort((a, b) => compare(a.title, b.title));
			return indexSection(type, entries.map(indexEntry));
		});
		const subdirectories = [...(options.subdirectories ?? [])].sort(compare);
		if (subdirectories.length > 0) {
			const entries = subdirectories.map((name) => indexEntry({ title: name, target: `${name}/index.md` }));
			sections.push(indexSection("Subdirectories", entries));
		}
		const header = options.okfVersion === undefined ? "" : indexFrontmatter(options.okfVersion);
		return header + sections.join("\n");
	};

	/** `## <date>` plus one `* <item>` line per item, newline-terminated (D-36). */
	static readonly renderLogEntry = (entry: LogEntry): string => logEntry(entry.date, entry.items);

	/** Index text for `dir` from the concepts directly in it plus its immediate child directories; no frontmatter. */
	static readonly synthesizeIndex = (bundle: LoadedBundle, dir: string): string => {
		const prefix = dir === "" ? "" : `${dir}/`;
		const concepts = [...bundle.concepts.values()].filter((concept) => dirnameOf(concept.path) === dir);
		const children = new Set<string>();
		for (const candidate of [...bundle.directories, ...bundle.indexes.keys()]) {
			if (candidate === "" || candidate === dir || !candidate.startsWith(prefix)) {
				continue;
			}
			const head = candidate.slice(prefix.length).split("/")[0];
			if (head !== undefined && head !== "") {
				children.add(head);
			}
		}
		return Derive.renderIndex(dir, concepts, { subdirectories: [...children] });
	};
}
