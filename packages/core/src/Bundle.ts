import type { Frontmatter } from "@effected/markdown";
import { FrontmatterDecodeError, MarkdownDocument, YamlFrontmatter } from "@effected/markdown";
import { DescendError } from "@effected/walker";
import { YamlParseError } from "@effected/yaml";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { Concept } from "./Concept.js";
import { ConceptId } from "./ConceptId.js";
import type { DiagnosticCode, DiagnosticSeverity } from "./Diagnostic.js";
import { Diagnostic, DiagnosticRange } from "./Diagnostic.js";
import { IndexDocument } from "./IndexDocument.js";
import { detectFence } from "./internal/fence.js";
import { decodeConcept } from "./internal/frontmatter.js";
import { toFileOffset } from "./internal/position.js";
import { basename, dirname } from "./internal/posixPath.js";
import { OPTIONS, parseIndex, parseLog } from "./internal/reserved.js";
import { DEFAULT_MAX_DEPTH, DEFAULT_PRUNE, walk } from "./internal/walk.js";
import { LogDocument } from "./LogDocument.js";

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
 * `# Computation` section body when present (D-20).
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

const blockRange = (text: string, node: Frontmatter): DiagnosticRange =>
	DiagnosticRange.fromOffset(text, node.position.start.offset, node.position.end.offset - node.position.start.offset);

/** Group A's `dirname` returns `"."` for a bundle-root file; `LoadedBundle` keys the root `""`. */
const directoryKey = (relativePath: string): string => {
	const dir = dirname(relativePath);
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
					diagnostic(file, "frontmatter-missing", "error", "concept files must start with a --- frontmatter block"),
				],
			};
		}
		const parsed = MarkdownDocument.parseResult(text, OPTIONS);
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
		if (reserved && basename(file) === "log.md") {
			const result = parseLog({ file, dir, document });
			return { diagnostics: result.diagnostics, log: result.document };
		}
		const node = document.frontmatter;
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
		const computation = document.sectionByHeading("Computation", { depth: 1 });
		const concept = LoadedConcept.make({
			id: id.value,
			path: file,
			frontmatter: result.concept.value,
			document,
			computationBody: computation === undefined ? Option.none() : Option.some(computation.body),
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
	 * Load the bundle at `options.root` (D-8, D-9, D-11 to D-14, D-21). Content never
	 * fails: every bad file becomes a diagnostic and loading continues (spec 8). A walk
	 * that descends past `options.maxDepth` fails typed with `BundleDepthExceededError`
	 * (W-1) rather than being silently truncated.
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
			const diagnostics: Array<Diagnostic> = walked.unreadable.map((dir) =>
				diagnostic(
					dir,
					"walk-unreadable",
					"warning",
					`directory "${dir}" could not be read; its files are not part of the bundle`,
				),
			);
			const concepts = new Map<ConceptId, LoadedConcept>();
			const indexes = new Map<string, IndexDocument>();
			const logs = new Map<string, LogDocument>();
			const directories = new Set<string>();
			for (const file of walked.files) {
				if (!file.endsWith(".md")) continue;
				const text = yield* fs
					.readFileString(path.join(root, file))
					.pipe(Effect.mapError((cause) => new BundleReadError({ root, path: file, cause })));
				const outcome = yield* loadMarkdown(file, text);
				diagnostics.push(...outcome.diagnostics);
				if (outcome.concept !== undefined) {
					concepts.set(outcome.concept.id, outcome.concept);
					directories.add(directoryKey(file));
				}
				if (outcome.index !== undefined) indexes.set(outcome.index.dir, outcome.index);
				if (outcome.log !== undefined) logs.set(outcome.log.dir, outcome.log);
			}
			return LoadedBundle.make({
				root,
				files: walked.files,
				directories: [...directories].sort(),
				concepts,
				indexes,
				logs,
				diagnostics,
			});
		},
	);
}
