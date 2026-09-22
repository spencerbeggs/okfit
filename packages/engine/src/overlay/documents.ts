import { Effect, FileSystem, Path, Result } from "effect";
import { DocumentPathError } from "../errors.js";
import { OverlayDocuments, makeOverlayFileSystem } from "./layer.js";

/**
 * One unsaved document: `path` is bundle-relative posix (`metrics/churn.md`),
 * `text` the full file contents.
 *
 * @public
 */
export interface DocumentInput {
	readonly path: string;
	readonly text: string;
}

/**
 * Resolve a bundle-relative posix path to the absolute key `Bundle.load` will
 * read (`path.join(root, relative)`, which also normalizes `.`/`..`), or say
 * why it cannot be.
 *
 * @public
 */
export const resolveDocumentPath = (
	path: Path.Path,
	root: string,
	relative: string,
): Result.Result<string, DocumentPathError> => {
	const reject = (reason: DocumentPathError["reason"]) =>
		Result.fail(new DocumentPathError({ path: relative, reason }));
	if (relative === "" || relative.includes("\\") || path.isAbsolute(relative)) return reject("not-relative");
	if (!relative.endsWith(".md")) return reject("not-markdown");
	const absolute = path.join(root, relative);
	const back = path.relative(root, absolute);
	if (back === "" || back === ".." || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
		return reject("escapes-bundle");
	}
	return Result.succeed(absolute);
};

/**
 * Run `self` with `documents` shadowing the ambient `FileSystem` under `root`
 * (spec 4.5). Every path is validated before `self` starts; the first bad one
 * fails `DocumentPathError` and `self` never runs. An empty list runs `self`
 * unchanged. The overlay is private to this call.
 *
 * @public
 */
export const provideDocuments =
	(root: string, documents: ReadonlyArray<DocumentInput>) =>
	<A, E, R>(
		self: Effect.Effect<A, E, R>,
	): Effect.Effect<A, E | DocumentPathError, R | FileSystem.FileSystem | Path.Path> =>
		documents.length === 0
			? self
			: Effect.gen(function* () {
					const path = yield* Path.Path;
					const overlay = OverlayDocuments.make();
					const seen = new Set<string>();
					for (const document of documents) {
						const resolved = resolveDocumentPath(path, root, document.path);
						if (Result.isFailure(resolved)) return yield* resolved.failure;
						if (seen.has(resolved.success)) {
							return yield* new DocumentPathError({ path: document.path, reason: "duplicate" });
						}
						seen.add(resolved.success);
						yield* overlay.open(resolved.success, document.text);
					}
					const underlying = yield* FileSystem.FileSystem;
					return yield* self.pipe(
						Effect.provideService(FileSystem.FileSystem, makeOverlayFileSystem(underlying, overlay)),
					);
				});
