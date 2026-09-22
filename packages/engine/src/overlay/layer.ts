import { ByteSize, Context, Effect, FileSystem, Layer, Option } from "effect";

/**
 * One open, possibly unsaved, document: its full text and the editor's version.
 *
 * @public
 */
export interface OverlayDocument {
	readonly text: string;
	readonly version: number;
}

/**
 * The open-document map. Keys are absolute, normalized paths, the same strings
 * `Bundle.load` builds with `path.join(root, file)`. Callers normalize; the
 * overlay compares strings verbatim.
 *
 * @public
 */
export interface OverlayDocumentsShape {
	/** Open or replace `path`; `version` defaults to 0. */
	readonly open: (path: string, text: string, version?: number) => Effect.Effect<void>;
	/** Replace `path`'s text; `version` defaults to the previous version plus one (0 plus one when not open). */
	readonly change: (path: string, text: string, version?: number) => Effect.Effect<void>;
	/** Forget `path`; later reads fall through to the underlying filesystem. */
	readonly close: (path: string) => Effect.Effect<void>;
	readonly get: (path: string) => Effect.Effect<Option.Option<OverlayDocument>>;
	readonly entries: () => Effect.Effect<ReadonlyArray<readonly [string, OverlayDocument]>>;
}

/**
 * Editor buffers that shadow the filesystem (spec 3.2). Mutable by design: an
 * LSP server changes it on every keystroke-level `didChange`.
 *
 * @public
 */
export class OverlayDocuments extends Context.Service<OverlayDocuments, OverlayDocumentsShape>()(
	"@okfit/engine/OverlayDocuments",
) {
	/** A fresh, empty overlay. */
	static readonly make = (): OverlayDocumentsShape => {
		const documents = new Map<string, OverlayDocument>();
		return {
			open: (path, text, version = 0) =>
				Effect.sync(() => {
					documents.set(path, { text, version });
				}),
			change: (path, text, version) =>
				Effect.sync(() => {
					documents.set(path, { text, version: version ?? (documents.get(path)?.version ?? 0) + 1 });
				}),
			close: (path) =>
				Effect.sync(() => {
					documents.delete(path);
				}),
			get: (path) => Effect.sync(() => Option.fromUndefinedOr(documents.get(path))),
			entries: () => Effect.sync(() => [...documents.entries()]),
		};
	};

	/** One fresh overlay per layer build. */
	static readonly layer: Layer.Layer<OverlayDocuments> = Layer.sync(OverlayDocuments, () => OverlayDocuments.make());
}

const encoder = new TextEncoder();

/** Parent directory and base name of an absolute path, on either separator. */
const parentAndName = (path: string): readonly [string, string] => {
	const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return [index <= 0 ? path.slice(0, index + 1) : path.slice(0, index), path.slice(index + 1)];
};

const trimTrailingSeparators = (path: string): string => (path.length > 1 ? path.replace(/[\\/]+$/, "") : path);

/** A `File.Info` for a document that exists only in the overlay. */
const overlayInfo = (text: string): FileSystem.File.Info => ({
	type: "File",
	mtime: Option.none(),
	atime: Option.none(),
	birthtime: Option.none(),
	dev: 0,
	ino: Option.none(),
	mode: 0o644,
	nlink: Option.none(),
	uid: Option.none(),
	gid: Option.none(),
	rdev: Option.none(),
	size: ByteSize.bytes(encoder.encode(text).byteLength),
	blksize: Option.none(),
	blocks: Option.none(),
});

/**
 * Wrap `underlying` so `readFile`, `readFileString`, `exists` and `stat` answer
 * from `documents` for open paths, and a non-recursive `readDirectory` also lists
 * open documents whose parent is the directory read (so a brand-new unsaved file
 * is walked). Every other member, and every path not open, is `underlying`'s.
 *
 * @public
 */
export const makeOverlayFileSystem = (
	underlying: FileSystem.FileSystem,
	documents: OverlayDocumentsShape,
): FileSystem.FileSystem =>
	FileSystem.FileSystem.of({
		...underlying,
		readFile: (path) =>
			Effect.flatMap(
				documents.get(path),
				Option.match({
					onNone: () => underlying.readFile(path),
					onSome: (document) => Effect.succeed(encoder.encode(document.text)),
				}),
			),
		readFileString: (path, encoding) =>
			Effect.flatMap(
				documents.get(path),
				Option.match({
					onNone: () => underlying.readFileString(path, encoding),
					onSome: (document) => Effect.succeed(document.text),
				}),
			),
		exists: (path) =>
			Effect.flatMap(
				documents.get(path),
				Option.match({ onNone: () => underlying.exists(path), onSome: () => Effect.succeed(true) }),
			),
		stat: (path) =>
			Effect.flatMap(
				documents.get(path),
				Option.match({
					onNone: () => underlying.stat(path),
					onSome: (document) =>
						underlying.stat(path).pipe(
							Effect.map(
								(info): FileSystem.File.Info => ({
									...info,
									size: ByteSize.bytes(encoder.encode(document.text).byteLength),
								}),
							),
							Effect.catchTag("PlatformError", (error) =>
								error.reason._tag === "NotFound" ? Effect.succeed(overlayInfo(document.text)) : Effect.fail(error),
							),
						),
				}),
			),
		readDirectory: (path, options) =>
			options?.recursive === true
				? underlying.readDirectory(path, options)
				: Effect.gen(function* () {
						const names = yield* underlying.readDirectory(path, options);
						const directory = trimTrailingSeparators(path);
						const extra = (yield* documents.entries())
							.map(([key]) => parentAndName(key))
							.filter(([parent, name]) => parent === directory && !names.includes(name))
							.map(([, name]) => name);
						return extra.length === 0 ? names : [...names, ...extra];
					}),
	});

/**
 * The ambient `FileSystem`, shadowed by the ambient `OverlayDocuments`.
 *
 * @public
 */
export const layerOverlayFileSystem: Layer.Layer<
	FileSystem.FileSystem,
	never,
	FileSystem.FileSystem | OverlayDocuments
> = Layer.effect(
	FileSystem.FileSystem,
	Effect.gen(function* () {
		const underlying = yield* FileSystem.FileSystem;
		const documents = yield* OverlayDocuments;
		return makeOverlayFileSystem(underlying, documents);
	}),
);
