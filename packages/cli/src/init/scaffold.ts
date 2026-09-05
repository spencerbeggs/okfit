import type { FrontmatterWriteError, MarkdownParseError } from "@effected/markdown";
import { MarkdownDocument, MarkdownFrontmatter, MarkdownParseOptions, YamlFrontmatter } from "@effected/markdown";
import type { OkfitConfig } from "@okfit/core";
import { Concept, ConceptId, Derive, LoadedConcept, OKF_SPEC_VERSION } from "@okfit/core";
import type { Layout } from "@okfit/profiles";
import { Effect, Option, Schema } from "effect";

/** `.config/okfit/config.toml`, relative to the project root (K-23). @public */
export const CONFIG_RELATIVE_PATH = ".config/okfit/config.toml";

/** @public */
export interface ScaffoldOptions {
	/** Absolute. */
	readonly projectRoot: string;
	/** Absolute; `<projectRoot>/<bundle.path>`. */
	readonly bundleRoot: string;
	/** The resolved profile's `layout` (`PROFILES/Profile.ts:35-38`, P-26). */
	readonly layout: Layout;
	/** The name written into the config and the log entry. */
	readonly profileName: string;
	/** `basename(projectRoot)` — `project.md`'s `title` (K-26). */
	readonly projectTitle: string;
	/** `YYYY-MM-DD`, derived from the CLI's `now` (K-25, K-47). */
	readonly today: string;
}

/** One file `init` will write. Pure data; this module imports no `FileSystem`. @public */
export interface ScaffoldFile {
	/** Absolute. */
	readonly path: string;
	readonly contents: string;
}

/**
 * K-23: the THIN override only — never the merged config. `bundle.path` is
 * the bundle root relative to the project root; `extensions: {}` satisfies
 * `OkfitConfig`'s one non-optional field (`CORE/OkfitConfig.ts:164`).
 * Everything else resolves from `DEFAULTS` and the profile at load time.
 * `actors.agent` is deliberately absent (K-24, P-17).
 *
 * @public
 */
export const configValue = (options: ScaffoldOptions & { readonly bundlePath: string }): OkfitConfig => ({
	bundle: { path: options.bundlePath, profile: options.profileName },
	extensions: {},
});

/**
 * Every path `init` will create, absolute, in write order, for the K-28
 * pre-flight: the config file, the bundle root's `index.md`/`log.md`/
 * `project.md`, then one `index.md` per layout directory in `layout`'s own
 * declared order — never re-sorted here. `Derive.renderIndex` sorts its own
 * `Subdirectories` section independently (C13), so this function's order has
 * no bearing on the rendered index text.
 *
 * @public
 */
export const targetPaths = (options: ScaffoldOptions): ReadonlyArray<string> => [
	`${options.projectRoot}/${CONFIG_RELATIVE_PATH}`,
	`${options.bundleRoot}/${options.layout.root.index}`,
	`${options.bundleRoot}/${options.layout.root.log}`,
	`${options.bundleRoot}/${options.layout.root.project}`,
	...options.layout.directories.map(
		(directory) => `${options.bundleRoot}/${directory.directory}/${options.layout.root.index}`,
	),
];

/** Frontmatter capture on — the write seam's own precondition (`MD/index.d.ts:1907-1920`; `CORE/internal/reserved.ts:15` precedent). */
const PARSE_OPTIONS = MarkdownParseOptions.make({ frontmatter: true });

/**
 * The four keys `project.md` actually carries (contract section 3.4's
 * worked transcript) — deliberately NOT the full `Concept` class. `Concept`'s
 * `extensions` and `raw` fields are required, not `optionalKey`
 * (`CORE/Concept.ts:39-40`), so encoding a `Concept.make` value through
 * `Concept` itself would serialize `extensions: {}` and `raw: {}` into the
 * frontmatter block too (verified: `Schema.encodeSync(Concept)` against a
 * `Concept.make` value with empty `extensions`/`raw` includes both keys,
 * this session). `Bundle.load` re-decodes a file written with this narrower
 * schema exactly as it would one written with the full class —
 * `internal/conceptDecode.ts` derives `extensions`/`raw` from whatever keys
 * the frontmatter block actually carries, never from what wrote it (verified
 * with a `Bundle.load` round trip, this session) — so the narrower schema
 * costs nothing at read time and matches the transcript byte-for-byte.
 */
const ProjectFrontmatter = Schema.Struct({
	type: Schema.Literal("Project"),
	title: Schema.String,
	description: Schema.String,
	status: Schema.Literals(["draft", "stable", "deprecated"]),
});

const PROJECT_DESCRIPTION = "What this project is, its boundaries, and its non-goals.";

const capitalize = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

const projectBody = (title: string): string =>
	[
		`# ${title}`,
		"",
		"## Purpose",
		"",
		"Describe what this project is for in one paragraph.",
		"",
		"## Boundaries",
		"",
		"Describe what this project owns and what it deliberately leaves to others.",
		"",
		"## Non-goals",
		"",
		"List what this project will not do, so a reader never infers it from silence.",
		"",
	].join("\n");

/**
 * The three root markdown files and the per-directory indexes (K-25 to
 * K-27, K-59). `project.md`'s frontmatter is written with
 * `MarkdownFrontmatter.setToString` — the INSERT path, since the body below
 * carries no frontmatter block of its own (`MD/index.d.ts:1959`,
 * `FrontmatterWriteError`'s own doc comment: "a document with no frontmatter
 * capture is the insert path, not an error"). The root `index.md` is
 * `Derive.renderIndex` over a `LoadedConcept` this function synthesizes from
 * the just-rendered `project.md` text, re-parsed with `MarkdownDocument.parse`
 * (K-59; `renderIndex` reads only `frontmatter.type`/`title`/`description`
 * and `path`, never `document`, `CORE/Derive.ts:75-101`, so the synthesized
 * value is faithful). Each per-directory `index.md` is the literal
 * `# <Directory>` — NOT `Derive.renderIndex`, which returns the empty string
 * for an empty concept list with no options (contract Judge notes item 2).
 *
 * @public
 */
export const files = (
	options: ScaffoldOptions,
): Effect.Effect<ReadonlyArray<ScaffoldFile>, MarkdownParseError | FrontmatterWriteError> =>
	Effect.gen(function* () {
		const { bundleRoot, layout, profileName, projectTitle, today } = options;

		const frontmatterData = {
			type: "Project" as const,
			title: projectTitle,
			description: PROJECT_DESCRIPTION,
			status: "draft" as const,
		};

		const draftDocument = yield* MarkdownDocument.parse(projectBody(projectTitle), PARSE_OPTIONS);
		const projectText = yield* MarkdownFrontmatter.setToString(ProjectFrontmatter, YamlFrontmatter)(
			draftDocument,
			frontmatterData,
		);

		const projectDocument = yield* MarkdownDocument.parse(projectText, PARSE_OPTIONS);
		const projectConcept = LoadedConcept.make({
			id: Option.getOrThrow(ConceptId.fromPath("project.md")),
			path: "project.md",
			frontmatter: Concept.make({ ...frontmatterData, extensions: {}, raw: frontmatterData }),
			document: projectDocument,
			computationBody: Option.none(),
		});

		const subdirectories = layout.directories.map((directory) => directory.directory);
		const rootIndexText = Derive.renderIndex("", [projectConcept], {
			okfVersion: OKF_SPEC_VERSION,
			subdirectories,
		});

		const logText = Derive.renderLogEntry({
			date: today,
			items: [`Initialized the bundle with the ${profileName} profile`],
		});

		const directoryFiles: ReadonlyArray<ScaffoldFile> = layout.directories.map((directory) => ({
			path: `${bundleRoot}/${directory.directory}/${layout.root.index}`,
			contents: `# ${capitalize(directory.directory)}\n`,
		}));

		return [
			{ path: `${bundleRoot}/${layout.root.index}`, contents: rootIndexText },
			{ path: `${bundleRoot}/${layout.root.log}`, contents: logText },
			{ path: `${bundleRoot}/${layout.root.project}`, contents: projectText },
			...directoryFiles,
		];
	});
