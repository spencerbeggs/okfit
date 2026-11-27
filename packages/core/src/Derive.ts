import { PosixPath } from "@effected/walker";
import { DateTime, Schema } from "effect";
import type { LoadedBundle, LoadedConcept } from "./Bundle.js";
import { Concept } from "./Concept.js";
import type { ConceptId } from "./ConceptId.js";
import type { IndexEntryInput, IndexSectionInput } from "./internal/templates.js";
import { indexDocument, logEntry } from "./internal/templates.js";
import { tierOf } from "./internal/tier.js";
import type { DerivedStatus } from "./Status.js";
import type { Verification } from "./Verification.js";

/**
 * Trust tier from the current `verified` events (OKF 0.3 §5.3, §7): no current event is unverified; current events
 * none of which is `human:` (a `team:` or unknown scheme included) are machine-confirmed; any current `human:` event
 * is human-reviewed. An event before the last `generated.at` is history: it stays in the file and counts for nothing.
 * @public
 */
export const TrustTier = Schema.Literals(["unverified", "machine-confirmed", "human-reviewed"]);

/** @public */
export type TrustTier = typeof TrustTier.Type;

/** Staleness; `unknown` means no `stale_after`, `malformed` a `stale_after` okfit cannot read (OKF 0.3 §5.5). @public */
export const Staleness = Schema.Literals(["fresh", "stale", "unknown", "malformed"]);

/** @public */
export type Staleness = typeof Staleness.Type;

/** One dated `log.md` group to render. @public */
export interface LogEntry {
	readonly date: string;
	readonly items: ReadonlyArray<string>;
}

/** One stale concept: its id, its `stale_after` instant, and whole days past it. @public */
export interface StaleConcept {
	readonly id: ConceptId;
	readonly staleAfter: DateTime.Utc;
	/** Whole days between `staleAfter` and `now`, floored; never negative. */
	readonly daysPast: number;
}

/** One concept whose `stale_after` is present but unreadable (OKF 0.3 §5.5): its id and the value as written. @public */
export interface MalformedStaleAfter {
	readonly id: ConceptId;
	/** The `stale_after` value as written: the string itself, `JSON.stringify` for any other value. */
	readonly raw: string;
}

/** Options for {@link Derive.renderIndex}. @public */
export interface RenderIndexOptions {
	/**
	 * Emits a root frontmatter block first (root index only). Without `frontmatter` it carries only
	 * `okf_version` (D-21); with it, `okf_version` is added only when the kept block declares none.
	 */
	readonly okfVersion?: string;
	/**
	 * The existing root block's YAML text (`IndexDocument.frontmatter`), re-emitted verbatim so a declared
	 * title, description, license, version or extension key survives a re-render (D6). `""` is absent.
	 */
	readonly frontmatter?: string;
	/**
	 * The bundle's `title` and `description` (OKF 0.3 §8.1), written after `okf_version` in a new root block.
	 * Ignored when `frontmatter` keeps an existing block: a kept block is never merged with it.
	 *
	 * @public
	 */
	readonly metadata?: { readonly title?: string; readonly description?: string };
	/** Rendered as `* [name](name/index.md)` under a trailing `# Subdirectories` section. */
	readonly subdirectories?: ReadonlyArray<string>;
}

/** `stale_after` is present in `raw` (not `null`, `""` or `[]`) yet did not decode to an instant. */
const isMalformedStaleAfter = (concept: Concept): boolean =>
	concept.stale_after === undefined && !Concept.isAbsent(concept.raw.stale_after);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
/** The bundle-relative directory of `path`; `""` for a file at the bundle root. */
const dirnameOf = (path: string): string => {
	const dir = PosixPath.dirname(path);
	return dir === "." ? "" : dir;
};
const relativeTarget = (dir: string, path: string): string =>
	dir !== "" && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;

/** Pure derivations (D-10, D-36): trust tier, status, staleness against a supplied instant, index/log rendering. @public */
export class Derive {
	private constructor() {}

	/**
	 * Whether a verification event at `at` is current for `concept` (OKF 0.3 §5.3): `at` is equal to or later than
	 * `generated.at` by instant, or `generated` or `generated.at` is absent. It reads only `generated`, so a caller holding
	 * no whole concept passes `{ generated }`.
	 *
	 * @public
	 */
	static readonly isCurrent = (
		concept: { readonly generated?: { readonly at?: DateTime.Utc } | undefined },
		at: DateTime.Utc,
	): boolean => {
		const generatedAt = concept.generated?.at;
		return generatedAt === undefined || DateTime.toEpochMillis(at) >= DateTime.toEpochMillis(generatedAt);
	};

	/**
	 * The decoded `verified` entries that are current ({@link Derive.isCurrent}), in list order. Earlier events stay
	 * in the file as history (OKF 0.3 §5.3) and are not returned.
	 *
	 * @public
	 */
	static readonly currentVerifications = (concept: Concept): ReadonlyArray<Verification> =>
		(concept.verified ?? []).filter((entry) => Derive.isCurrent(concept, entry.at));

	/**
	 * The trust tier from {@link Derive.currentVerifications} only (OKF 0.3 §5.3, §7; §11.2 makes it a MUST for every
	 * bundle): none is unverified, any `human:` verifier is human-reviewed, otherwise machine-confirmed.
	 *
	 * @public
	 */
	static readonly trustTier = (concept: Concept): TrustTier => {
		return tierOf(Derive.currentVerifications(concept));
	};

	/**
	 * The typed status; `unknown` when `raw.status` is present (not `null`, `""` or `[]`) but outside the
	 * vocabulary; `stable` when absent (OKF 0.3 §5.4).
	 */
	static readonly status = (concept: Concept): DerivedStatus => {
		if (concept.status !== undefined) return concept.status;
		return Derive.rawStatus(concept) === undefined ? "stable" : "unknown";
	};

	/** The `status` value as written, as text for display; `undefined` when absent, `null`, `""` or `[]`. */
	static readonly rawStatus = (concept: Concept): string | undefined => {
		const value: unknown = concept.raw.status;
		if (Concept.isAbsent(value)) return undefined;
		return typeof value === "string" ? value : JSON.stringify(value);
	};

	/**
	 * `stale` when `now >= stale_after` (OKF 0.3 §5.5); `unknown` without `stale_after`; `malformed`
	 * when `raw.stale_after` is present (not `null`, `""` or `[]`) but unreadable, so never fresh and never stale.
	 */
	static readonly staleness = (concept: Concept, now: DateTime.Utc): Staleness => {
		if (concept.stale_after === undefined) return isMalformedStaleAfter(concept) ? "malformed" : "unknown";
		return DateTime.toEpochMillis(now) >= DateTime.toEpochMillis(concept.stale_after) ? "stale" : "fresh";
	};

	/** Boolean form of {@link Derive.staleness} (D-36). */
	static readonly isStale = (concept: Concept, now: DateTime.Utc): boolean =>
		Derive.staleness(concept, now) === "stale";

	/**
	 * Every concept in `bundle` that {@link Derive.isStale} reports stale against
	 * `now`, sorted by id ascending. Pure (D-10); `now` is always an argument,
	 * never read from a clock here (D-36).
	 */
	static readonly staleReport = (bundle: LoadedBundle, now: DateTime.Utc): ReadonlyArray<StaleConcept> => {
		const out: Array<StaleConcept> = [];
		for (const [id, concept] of bundle.concepts) {
			const staleAfter = concept.frontmatter.stale_after;
			if (staleAfter === undefined) continue;
			if (!Derive.isStale(concept.frontmatter, now)) continue;
			const millisPast = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(staleAfter);
			out.push({ id, staleAfter, daysPast: Math.floor(millisPast / 86_400_000) });
		}
		return out.sort((a, b) => compare(a.id, b.id));
	};

	/**
	 * Every concept in `bundle` whose {@link Derive.staleness} is `malformed` (OKF 0.3 §5.5: an unreadable
	 * `stale_after` is never fresh), with the value as written, sorted by id ascending. `staleReport` never
	 * lists these. A malformed value does not depend on the instant, so there is no `now` argument.
	 */
	static readonly malformedStaleAfter = (bundle: LoadedBundle): ReadonlyArray<MalformedStaleAfter> => {
		const out: Array<MalformedStaleAfter> = [];
		for (const [id, concept] of bundle.concepts) {
			if (!isMalformedStaleAfter(concept.frontmatter)) continue;
			const value: unknown = concept.frontmatter.raw.stale_after;
			out.push({ id, raw: typeof value === "string" ? value : JSON.stringify(value) });
		}
		return out.sort((a, b) => compare(a.id, b.id));
	};

	/** Frontmatter `title`, else the file name without `.md` (OKF 0.3 §4.1). */
	static readonly title = (concept: LoadedConcept): string =>
		concept.frontmatter.title ?? PosixPath.basename(concept.path).replace(/\.md$/, "");

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
		const sections: Array<IndexSectionInput> = [...groups.keys()].sort(compare).map((type) => ({
			heading: type,
			entries: (groups.get(type) ?? []).sort((a, b) => compare(a.title, b.title)),
		}));
		const subdirectories = [...(options.subdirectories ?? [])].sort(compare);
		if (subdirectories.length > 0) {
			sections.push({
				heading: "Subdirectories",
				entries: subdirectories.map((name) => ({ title: name, target: `${name}/index.md` })),
			});
		}
		return indexDocument(sections, {
			...(options.okfVersion === undefined ? {} : { okfVersion: options.okfVersion }),
			...(options.frontmatter === undefined ? {} : { frontmatter: options.frontmatter }),
			...(options.metadata === undefined ? {} : { metadata: options.metadata }),
		});
	};

	/** `## <date>` plus one `* <item>` line per item, newline-terminated (D-36). */
	static readonly renderLogEntry = (entry: LogEntry): string => logEntry(entry.date, entry.items);

	/**
	 * Assemble a whole log document from its groups: `# <title>\n\n` followed
	 * by each group's own {@link Derive.renderLogEntry} rendering, joined by
	 * one blank line (S-11). Default title `"Log"`. `init` and `sync`'s log
	 * mode both call this instead of hand-assembling the join; `sync`'s
	 * `mergeLog` uses it only for brand-new groups it renders, since existing
	 * groups are re-emitted verbatim from source.
	 */
	static readonly renderLog = (groups: ReadonlyArray<LogEntry>, options?: { readonly title?: string }): string => {
		const title = options?.title ?? "Log";
		if (groups.length === 0) return `# ${title}\n`;
		return `# ${title}\n\n${groups.map(Derive.renderLogEntry).join("\n")}`;
	};

	/**
	 * Every directory that owes an `index.md`: each directory holding a concept, plus its ancestors up to
	 * (not including) the bundle root, which a parent index links to even when it holds no concept itself.
	 * The root (`""`) is included only when it holds a concept. Sorted.
	 */
	static readonly indexDirectories = (bundle: LoadedBundle): ReadonlyArray<string> => {
		const dirs = new Set<string>();
		for (const dir of bundle.directories) {
			dirs.add(dir);
			for (let ancestor = dirnameOf(dir); ancestor !== ""; ancestor = dirnameOf(ancestor)) dirs.add(ancestor);
		}
		return [...dirs].sort();
	};

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
