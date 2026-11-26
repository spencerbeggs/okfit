import type { Frontmatter, MarkdownParseError } from "@effected/markdown";
import { FrontmatterDecodeError, MarkdownDocument, MarkdownVisitor, YamlFrontmatter } from "@effected/markdown";
import { DescendError, PosixPath, confineReal } from "@effected/walker";
import { YamlParseError } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { Concept } from "./Concept.js";
import { ConceptId } from "./ConceptId.js";
import { readConfinedString } from "./ConfinedRead.js";
import type { DiagnosticCode, DiagnosticSeverity } from "./Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "./Diagnostic.js";
import { IndexDocument } from "./IndexDocument.js";
import { detectFence } from "./internal/fence.js";
import { decodeConcept } from "./internal/frontmatter.js";
import { scanLinks } from "./internal/linkScan.js";
import { toFileOffset } from "./internal/position.js";
import { OPTIONS, parseIndex, parseLog } from "./internal/reserved.js";
import { DEFAULT_MAX_DEPTH, DEFAULT_PRUNE, walk } from "./internal/walk.js";
import { LogDocument } from "./LogDocument.js";
import { OkfVersion } from "./OkfVersion.js";

/**
 * The bundle root does not exist or is not a directory (D-9).
 *
 * @public
 */
export class BundleRootNotFoundError extends Schema.TaggedError<BundleRootNotFoundError>()("BundleRootNotFoundError", {
	root: Schema.String,
}) {
	override get message(): string {
		return `bundle root "${this.root}" is not a directory`;
	}
}

/**
 * A directory or file under the root could not be read. Never raised for content (spec 8).
 *
 * @public
 */
export class BundleReadError extends Schema.TaggedError<BundleReadError>()("BundleReadError", {
	root: Schema.String,
	/** Bundle-relative posix path; `""` for the root. */
	path: Schema.String,
	/** The `PlatformError`, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return this.path === ""
			? `bundle root "${this.root}" could not be read`
			: `bundle file "${this.path}" under "${this.root}" could not be read`;
	}
}

/**
 * The walk descended past `maxDepth` (D-8). A depth cap that silently truncated would
 * silently change membership, which D-9 forbids; the cap fails instead.
 *
 * @public
 */
export class BundleDepthExceededError extends Schema.TaggedError<BundleDepthExceededError>()(
	"BundleDepthExceededError",
	{
		root: Schema.String,
		/** Bundle-relative posix path of the directory the walk could not enter. */
		path: Schema.String,
		limit: Schema.Number,
	},
) {
	override get message(): string {
		return `bundle "${this.root}" descends past ${this.limit} levels at "${this.path}"`;
	}
}

/**
 * Everything `Bundle.load` can fail with.
 *
 * @public
 */
export type BundleLoadError = BundleRootNotFoundError | BundleReadError | BundleDepthExceededError;

/**
 * Options for {@link Bundle.load} (D-8).
 *
 * @public
 */
export interface BundleLoadOptions {
	/** Absolute bundle root; core never reads `process.cwd()`. */
	readonly root: string;
	/** Admit entries whose name starts with `.` (default `false`, D-11). */
	readonly includeHidden?: boolean;
	/** Directory levels below the root to descend; positive integer, default 256; exceeding it fails with `BundleDepthExceededError`. */
	readonly maxDepth?: number;
	/** Directory names never descended (default `["node_modules", ".git"]`). */
	readonly prune?: ReadonlyArray<string>;
}

/**
 * One concept file after loading: typed frontmatter, the parsed body, and the
 * inline computation when present.
 *
 * @remarks
 * `computationBody` is the inline form only. 0.3 or later: the code of the first fenced block in
 * the first `Computation` section at any heading level (an empty fence yields an empty string; no
 * fence is `None`). 0.2 or undeclared: the body of the depth-1 `Computation` section. When
 * `attested.computation` is set, the file that path names is the computation (OKF 0.3 10.3 rule 1)
 * and this field is not authoritative; core does not read that file.
 *
 * @public
 */
export class LoadedConcept extends Schema.Class<LoadedConcept>("LoadedConcept")({
	id: ConceptId,
	/** Posix bundle-relative path with `.md`. */
	path: Schema.String,
	frontmatter: Concept,
	document: MarkdownDocument,
	computationBody: Schema.Option(Schema.String),
}) {}

/**
 * The result of {@link Bundle.load}: every walked file, every directory holding a
 * concept, concepts by id, reserved documents by directory, load-time diagnostics.
 *
 * @public
 */
export class LoadedBundle extends Schema.Class<LoadedBundle>("LoadedBundle")({
	root: Schema.String,
	files: Schema.Array(Schema.String),
	directories: Schema.Array(Schema.String),
	concepts: Schema.ReadonlyMap(ConceptId, LoadedConcept),
	indexes: Schema.ReadonlyMap(Schema.String, IndexDocument),
	logs: Schema.ReadonlyMap(Schema.String, LogDocument),
	diagnostics: Schema.Array(Diagnostic),
}) {}

const diagnostic = (
	file: string,
	code: DiagnosticCode,
	severity: DiagnosticSeverity,
	message: string,
	range?: DiagnosticRange,
): Diagnostic =>
	Diagnostic.make(range === undefined ? { file, code, severity, message } : { file, code, severity, message, range });

/** CommonMark: a fence opens with three backticks or tildes after at most three spaces; four or more is indented code. */
const FENCE_OPENING = /^ {0,3}(```|~~~)/;

/**
 * OKF 0.3 10.3: the code of the first fenced block in the first `Computation` section, in source order.
 *
 * @remarks
 * Blocks nested in a list item or block quote count (R17): the section's blocks are walked depth first.
 * A deeper sub-heading does not end the section (`sectionByHeading` keeps its subsections), and the first
 * fenced block wins even when it sits in a list item before a root-level fence. A code node's position starts
 * at the fence character when it is fenced and at its indentation when it is an indented block, so the fence
 * test reads from the node's own start; its `value` already has the container's indentation and `> ` markers
 * removed and the inner relative indentation kept.
 */
const fencedComputation = (document: MarkdownDocument): Option.Option<string> =>
	Option.flatMapNullishOr(document.sectionByHeading("Computation"), (section) => {
		const first = section.children[0];
		const last = section.children[section.children.length - 1];
		if (first === undefined || last === undefined) return undefined;
		// `walk` takes a root, so walk the document once (pre-order is source order) and keep the section's span.
		const from = first.position.start.offset;
		const to = last.position.end.offset;
		for (const event of MarkdownVisitor.walk(document.root)) {
			if (event._tag !== "Enter" || event.node.type !== "code") continue;
			const offset = event.node.position.start.offset;
			if (offset < from || offset >= to) continue;
			if (FENCE_OPENING.test(document.source.slice(offset, offset + 6))) return event.node.value;
		}
		return undefined;
	});

const blockRange = (text: string, node: Frontmatter): DiagnosticRange =>
	DiagnosticRange.fromOffset(text, node.position.start.offset, node.position.end.offset - node.position.start.offset);

/** Group A's `dirname` returns `"."` for a bundle-root file; `LoadedBundle` keys the root `""`. */
const directoryKey = (relativePath: string): string => {
	const dir = PosixPath.dirname(relativePath);
	return dir === "." ? "" : dir;
};

interface Decoded {
	readonly raw: Option.Option<unknown>;
	readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** Decode a captured YAML block; a failure is one `frontmatter-unparseable` with a file-mapped range (D-14). */
const readFrontmatter = (file: string, text: string, node: Frontmatter): Effect.Effect<Decoded> =>
	Effect.map(Effect.result(YamlFrontmatter.decode(node)), (result) => {
		if (Result.isSuccess(result)) return { raw: Option.some(result.success), diagnostics: [] };
		const error = result.failure;
		const yaml =
			error instanceof FrontmatterDecodeError && error.cause instanceof YamlParseError
				? error.cause.diagnostics[0]
				: undefined;
		const range =
			yaml === undefined
				? blockRange(text, node)
				: DiagnosticRange.fromOffset(text, toFileOffset(text, yaml.offset), yaml.length);
		return {
			raw: Option.none(),
			diagnostics: [
				diagnostic(file, "frontmatter-unparseable", "error", yaml === undefined ? error.message : yaml.message, range),
			],
		};
	});

interface FileOutcome {
	readonly diagnostics: ReadonlyArray<Diagnostic>;
	readonly concept?: LoadedConcept;
	readonly index?: IndexDocument;
	readonly log?: LogDocument;
}

const loadMarkdown = (file: string, text: string): Effect.Effect<FileOutcome> =>
	Effect.gen(function* () {
		const reserved = ConceptId.isReservedFile(file);
		const fence = detectFence(text);
		if (fence === "unclosed") {
			return {
				diagnostics: [
					diagnostic(
						file,
						"frontmatter-unclosed",
						"error",
						"frontmatter opens with --- but never closes",
						DiagnosticRange.fromOffset(text, 0, 3),
					),
				],
			};
		}
		if (fence === "absent" && !reserved) {
			return {
				diagnostics: [
					diagnostic(
						file,
						"frontmatter-missing",
						"warning",
						"no frontmatter, so this file is not a concept and is skipped",
					),
				],
			};
		}
		const parsed = Bundle.parseDocument(text);
		if (Result.isFailure(parsed)) {
			const d = parsed.failure.diagnostic;
			return {
				diagnostics: [
					diagnostic(
						file,
						"frontmatter-unparseable",
						"error",
						d.message,
						DiagnosticRange.fromOffset(text, d.offset, d.length),
					),
				],
			};
		}
		const document = parsed.success;
		const dir = directoryKey(file);
		if (reserved && PosixPath.basename(file) === "log.md") {
			const result = parseLog({ file, dir, document });
			return { diagnostics: result.diagnostics, log: result.document };
		}
		const node = Option.getOrUndefined(document.frontmatter);
		const decoded: Decoded =
			node === undefined ? { raw: Option.none(), diagnostics: [] } : yield* readFrontmatter(file, text, node);
		if (reserved) {
			const result = parseIndex({ file, dir, document, frontmatter: decoded.raw });
			return { diagnostics: [...decoded.diagnostics, ...result.diagnostics], index: result.document };
		}
		if (node === undefined || Option.isNone(decoded.raw)) return { diagnostics: decoded.diagnostics };
		const result = decodeConcept(decoded.raw.value, { file, text, node });
		const diagnostics = [...decoded.diagnostics, ...result.diagnostics];
		const id = ConceptId.fromPath(file);
		if (Option.isNone(result.concept) || Option.isNone(id)) return { diagnostics };
		const concept = LoadedConcept.make({
			id: id.value,
			path: file,
			frontmatter: result.concept.value,
			document,
			computationBody: Bundle.inlineComputation(document, "legacy"),
		});
		return { diagnostics, concept };
	});

/**
 * Static facade for loading a bundle (D-6). Only `FileSystem` and `Path` are required
 * (spec 3.2); `Path` is used solely for `path.join(root, relative)` (D-27).
 *
 * @public
 */
export class Bundle {
	private constructor() {}

	/**
	 * Parse Markdown text exactly as `Bundle.load` parses every bundle file (frontmatter on), so a tool that
	 * scans a file the loader did not keep as a concept reads its body the way a concept's is read.
	 */
	static readonly parseDocument = (text: string): Result.Result<MarkdownDocument, MarkdownParseError> =>
		MarkdownDocument.parseResult(text, OPTIONS);

	/**
	 * Pure. The inline computation of `document` under one reading of the spec: `"legacy"` (OKF 0.2) is the body
	 * of the depth-1 `Computation` section, `"current"` (OKF 0.3 section 10.3) is the first fenced block of the
	 * first `Computation` section at any heading level. `None` when the reading finds nothing. `Bundle.load` calls
	 * this for the reading its bundle's declared version selects; a tool comparing the two readings calls it twice.
	 *
	 * @public
	 */
	static readonly inlineComputation = (
		document: MarkdownDocument,
		reading: "legacy" | "current",
	): Option.Option<string> =>
		reading === "legacy"
			? Option.map(document.sectionByHeading("Computation", { depth: 1 }), (section) => section.body)
			: fencedComputation(document);

	/**
	 * Load the bundle at `options.root` (D-8, D-9, D-11 to D-14, D-21). Content never
	 * fails: every bad file becomes a diagnostic and loading continues (spec 8). A walk
	 * that descends past `options.maxDepth` fails typed with `BundleDepthExceededError`
	 * (W-1) rather than being silently truncated.
	 *
	 * A symbolic link is never followed out of the bundle (OKF 0.3 section 3.2 rule 5). A file link that leaves
	 * it, a directory link that leaves it (nothing under it is read), and a link of either kind whose resolution
	 * fails (dangling, a loop, an unreadable target) each record a `symlink-escape` warning at their own path
	 * (pruned directory names are not checked, hidden ones only under `includeHidden`); a directory link that stays inside is never walked and
	 * records nothing. Each Markdown file is read confined (`readConfinedString`): a file that becomes a link out of
	 * the bundle between the link check and the read is refused as `symlink-escape`, and one that changed under the
	 * read (`changed`) is recorded `read-changed` ("try again") and left out of that load. A race through a directory above
	 * the file can still win (spencerbeggs/okfit#524).
	 */
	static readonly load: (
		options: BundleLoadOptions,
	) => Effect.Effect<LoadedBundle, BundleLoadError, FileSystem.FileSystem | Path.Path> = Effect.fn("Bundle.load")(
		function* (options: BundleLoadOptions) {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = options.root;
			const info = yield* fs
				.stat(root)
				.pipe(
					Effect.mapError((cause) =>
						cause.reason._tag === "NotFound"
							? new BundleRootNotFoundError({ root })
							: new BundleReadError({ root, path: "", cause }),
					),
				);
			if (info.type !== "Directory") return yield* new BundleRootNotFoundError({ root });
			const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
			const toLoadError = (error: DescendError | PlatformError.PlatformError): BundleLoadError => {
				if (!(error instanceof DescendError)) return new BundleReadError({ root, path: "", cause: error });
				if (error.reason === "depthExceeded") {
					return new BundleDepthExceededError({ root, path: error.path, limit: error.limit ?? maxDepth });
				}
				return new BundleReadError({ root, path: error.path, cause: error });
			};
			const walked = yield* walk({
				root,
				includeHidden: options.includeHidden ?? false,
				maxDepth,
				prune: new Set(options.prune ?? DEFAULT_PRUNE),
			}).pipe(Effect.mapError(toLoadError));
			const diagnostics: Array<Diagnostic> = walked.unreadable.map(({ path: dir, reason }) =>
				diagnostic(
					dir,
					"walk-unreadable",
					"warning",
					`directory "${dir}" could not be read (${reason}); its files are not part of the bundle`,
				),
			);
			const files: Array<string> = [];
			for (const file of walked.files) {
				const link = yield* fs
					.lstat(path.join(root, file))
					.pipe(Effect.mapError((cause) => new BundleReadError({ root, path: file, cause })));
				if (link.type === "SymbolicLink") {
					const refused = yield* confineReal(root, path.join(root, file)).pipe(
						Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }),
					);
					if (refused !== undefined) {
						const why =
							refused.reason === "outside"
								? "resolves outside the bundle root"
								: "could not be resolved, so it cannot be shown to stay inside the bundle root";
						diagnostics.push(
							diagnostic(
								file,
								"symlink-escape",
								"warning",
								`symbolic link ${why}; it is not read and not part of the bundle`,
							),
						);
						continue;
					}
				}
				files.push(file);
			}
			// The walker enters no directory link and drops a dangling or unresolvable one without a trace, so neither
			// reaches the file loop; `scanLinks` reports them (containment decided on the real path).
			const links = yield* scanLinks(root, walked, {
				includeHidden: options.includeHidden ?? false,
				prune: new Set(options.prune ?? DEFAULT_PRUNE),
			}).pipe(Effect.mapError((failure) => new BundleReadError({ root, path: failure.path, cause: failure.cause })));
			for (const link of links) diagnostics.push(diagnostic(link.file, "symlink-escape", "warning", link.message));
			const concepts = new Map<ConceptId, LoadedConcept>();
			const indexes = new Map<string, IndexDocument>();
			const logs = new Map<string, LogDocument>();
			const directories = new Set<string>();
			const refusedAtRead = new Set<string>();
			for (const file of files) {
				if (!file.endsWith(".md")) continue;
				// Read confined: the file is opened, its path resolved and the two compared, so a file that became a
				// link out between the checks above and this read is refused, not read.
				const read = yield* readConfinedString(root, path.join(root, file)).pipe(
					Effect.map((text) => ({ text })),
					Effect.catchTag("ConfinementError", (error) => Effect.succeed({ refused: error.reason })),
					Effect.mapError((cause) => new BundleReadError({ root, path: file, cause })),
				);
				if ("refused" in read) {
					refusedAtRead.add(file);
					// `changed` is a transient read failure, never an escape verdict: reading again may succeed.
					diagnostics.push(
						read.refused === "changed"
							? diagnostic(
									file,
									"read-changed",
									"warning",
									`file "${file}" changed while it was read; try again. It is not part of this load`,
								)
							: diagnostic(
									file,
									"symlink-escape",
									"warning",
									`symbolic link ${
										read.refused === "outside"
											? "resolves outside the bundle root"
											: "could not be resolved, so it cannot be shown to stay inside the bundle root"
									}; it is not read and not part of the bundle`,
								),
					);
					continue;
				}
				const outcome = yield* loadMarkdown(file, read.text);
				diagnostics.push(...outcome.diagnostics);
				if (outcome.concept !== undefined) {
					concepts.set(outcome.concept.id, outcome.concept);
					directories.add(directoryKey(file));
				}
				if (outcome.index !== undefined) indexes.set(outcome.index.dir, outcome.index);
				if (outcome.log !== undefined) logs.set(outcome.log.dir, outcome.log);
			}
			const bundle = LoadedBundle.make({
				root,
				files: refusedAtRead.size === 0 ? files : files.filter((file) => !refusedAtRead.has(file)),
				directories: [...directories].sort(),
				concepts,
				indexes,
				logs,
				diagnostics,
			});
			if (OkfVersion.legacyFallbacks(bundle)) return bundle;
			// The root index is read after most concepts, so a 0.3 bundle's locator runs once it is known.
			const located = new Map<ConceptId, LoadedConcept>();
			for (const [conceptId, concept] of concepts) {
				located.set(
					conceptId,
					LoadedConcept.make({
						...concept,
						computationBody: Bundle.inlineComputation(concept.document, "current"),
					}),
				);
			}
			return LoadedBundle.make({ ...bundle, concepts: located });
		},
	);
}
