import { ByteSize, Context, Effect, FileSystem, Layer, Option, PlatformError } from "effect";

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

/**
 * A stable identity for a path that exists only in the overlay: a confined read (`readConfinedBytes`) compares the
 * open file's `dev` and `ino` with those of `stat`, and refuses a file with no `ino`. An overlay-only document has
 * no inode, so it gets one derived from its path (FNV-1a, 64 bits); `stat` and the open file report the same one.
 */
const overlayIno = (path: string): bigint => {
	let hash = 0xcbf29ce484222325n;
	for (const unit of path) {
		hash = BigInt.asUintN(64, (hash ^ BigInt(unit.codePointAt(0) ?? 0)) * 0x100000001b3n);
	}
	return hash;
};

/** A `File.Info` for a document that exists only in the overlay. */
const overlayInfo = (path: string, text: string): FileSystem.File.Info => ({
	type: "File",
	mtime: Option.none(),
	atime: Option.none(),
	birthtime: Option.none(),
	dev: 0n,
	ino: Option.some(overlayIno(path)),
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
 * `read`'s `File.Info` for `path`, with an open document's size, or a plain
 * file's info for a document that exists only in the overlay.
 */
const shadowInfo = (
	documents: OverlayDocumentsShape,
	path: string,
	read: FileSystem.FileSystem["stat"],
): Effect.Effect<FileSystem.File.Info, PlatformError.PlatformError> =>
	Effect.flatMap(
		documents.get(path),
		Option.match({
			onNone: () => read(path),
			onSome: (document) =>
				read(path).pipe(
					Effect.map(
						(info): FileSystem.File.Info => ({
							...info,
							size: ByteSize.bytes(encoder.encode(document.text).byteLength),
						}),
					),
					Effect.catchTag("PlatformError", (error) =>
						error.reason._tag === "NotFound" ? Effect.succeed(overlayInfo(path, document.text)) : Effect.fail(error),
					),
				),
		}),
	);

/** {@link shadowInfo}, and for a not-found path the info of the open document whose real path it is. */
const shadowOrAliased = (
	documents: OverlayDocumentsShape,
	underlying: FileSystem.FileSystem,
	path: string,
	read: FileSystem.FileSystem["stat"],
): Effect.Effect<FileSystem.File.Info, PlatformError.PlatformError> =>
	shadowInfo(documents, path, read).pipe(
		Effect.catchTag("PlatformError", (error) =>
			error.reason._tag !== "NotFound"
				? Effect.fail(error)
				: Effect.flatMap(documentAtRealPath(documents, underlying, path), (found) =>
						Option.isSome(found)
							? Effect.succeed(overlayInfo(found.value[0], found.value[1].text))
							: Effect.fail(error),
					),
		),
	);

/** The real path of an overlay-only document: its real parent directory plus its name (its key when the parent is gone). */
const overlayRealPath = (
	underlying: FileSystem.FileSystem,
	path: string,
): Effect.Effect<string, PlatformError.PlatformError> =>
	underlying.realPath(path).pipe(
		Effect.catchReason("PlatformError", "NotFound", () => {
			const [parent, name] = parentAndName(path);
			const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
			return underlying.realPath(parent).pipe(
				Effect.map((real) => `${trimTrailingSeparators(real)}${separator}${name}`),
				Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(path)),
			);
		}),
	);

/** The open document, if any, whose real path is `path` (a document whose key spells the path through a link). */
const documentAtRealPath = (
	documents: OverlayDocumentsShape,
	underlying: FileSystem.FileSystem,
	path: string,
): Effect.Effect<Option.Option<readonly [string, OverlayDocument]>> =>
	Effect.gen(function* () {
		const [, name] = parentAndName(path);
		for (const [key, document] of yield* documents.entries()) {
			if (parentAndName(key)[1] !== name) continue;
			const real = yield* overlayRealPath(underlying, key).pipe(Effect.orElseSucceed(() => key));
			if (real === path) return Option.some([key, document] as const);
		}
		return Option.none<readonly [string, OverlayDocument]>();
	});

/**
 * An open document's bytes. A decoder that drops a leading BOM (the loader's, as Effect's
 * `FileSystem.readFileString` does, a `TextDecoder`; Node's `fs.readFileSync` keeps it) would also drop one the
 * editor's buffer carries, which the overlay has always kept: a buffer that starts with a BOM is encoded with a
 * second one, so exactly the buffer's own text survives the decode. So the bytes `open` serves carry one more BOM
 * than `readFile`'s for such a buffer: a byte consumer of `open` sees a phantom BOM. Only `validate` and the LSP
 * use the overlay, and both decode.
 */
const overlayBytes = (text: string): Uint8Array => encoder.encode(text.startsWith("\uFEFF") ? `\uFEFF${text}` : text);

/** A read-only `File` over `bytes`, whose `stat` is `info`. Every write fails `BadArgument`. */
const overlayFile = (
	path: string,
	bytes: Uint8Array,
	info: Effect.Effect<FileSystem.File.Info, PlatformError.PlatformError>,
): FileSystem.File => {
	let cursor = 0;
	const readOnly = (method: string) =>
		Effect.fail(
			PlatformError.badArgument({
				module: "FileSystem",
				method,
				description: `${path} is an open document, read-only here`,
			}),
		);
	return {
		[FileSystem.FileTypeId]: FileSystem.FileTypeId,
		stat: info,
		seek: (offset) =>
			Effect.sync(() => {
				cursor = Number(offset);
				return BigInt(cursor);
			}),
		sync: Effect.void,
		read: (buffer, options) =>
			Effect.sync(() => {
				const from = options?.position === undefined ? cursor : Number(options.position);
				const chunk = bytes.subarray(from, from + buffer.length);
				buffer.set(chunk);
				if (options?.position === undefined) cursor += chunk.length;
				return chunk.length;
			}),
		readAlloc: (size, options) =>
			Effect.sync(() => {
				const from = options?.position === undefined ? cursor : Number(options.position);
				if (from >= bytes.length) return Option.none();
				const chunk = bytes.slice(from, from + size);
				if (options?.position === undefined) cursor += chunk.length;
				return Option.some(chunk);
			}),
		truncate: () => readOnly("truncate"),
		write: () => readOnly("write"),
		writeAll: () => readOnly("writeAll"),
	};
};

/**
 * Wrap `underlying` so `readFile`, `readFileString`, `exists`, `stat`, `lstat`, `realPath` and a read-only `open` answer
 * from `documents` for open paths, and a non-recursive `readDirectory` (and
 * `readDirectoryEntries`, Effect 4.1's typed listing, as a `"File"`) also lists
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
		// A read-only open of an open document serves its text, so a confined read (`readConfinedBytes`, which reads
		// from the open file) sees the editor's buffer; every other open is the underlying one.
		open: (path, options) =>
			options?.flag !== undefined && options.flag !== "r"
				? underlying.open(path, options)
				: Effect.flatMap(
						documents.get(path),
						Option.match({
							onNone: () => underlying.open(path, options),
							onSome: (document) =>
								Effect.succeed(
									overlayFile(path, overlayBytes(document.text), shadowInfo(documents, path, underlying.stat)),
								),
						}),
					),
		// An overlay-only document has no real path on disk: its real parent directory plus its name, so a confined
		// read resolves it the way it would a file just saved there.
		realPath: (path) =>
			Effect.flatMap(
				documents.get(path),
				Option.match({
					onNone: () => underlying.realPath(path),
					onSome: () => overlayRealPath(underlying, path),
				}),
			),
		exists: (path) =>
			Effect.flatMap(
				documents.get(path),
				Option.match({ onNone: () => underlying.exists(path), onSome: () => Effect.succeed(true) }),
			),
		// A confined read `lstat`s the real path of what it opened. For an overlay-only document that path differs from
		// the document's key whenever a directory above it is a link (or `/var` is `/private/var`), so a not-found
		// stat or lstat also answers for the document whose real path this is.
		stat: (path) => shadowOrAliased(documents, underlying, path, underlying.stat),
		// The walker `lstat`s every entry (it never enters a symlink unasked), so
		// an overlay-only file must answer here too or the walk drops it.
		lstat: (path) => shadowOrAliased(documents, underlying, path, underlying.lstat),
		readDirectory: (path, options) =>
			options?.recursive === true
				? underlying.readDirectory(path, options)
				: Effect.gen(function* () {
						const names = yield* underlying.readDirectory(path, options);
						const extra = yield* overlayOnlyNames(documents, path, names);
						return extra.length === 0 ? names : [...names, ...extra];
					}),
		readDirectoryEntries: (path) =>
			Effect.gen(function* () {
				const entries = yield* underlying.readDirectoryEntries(path);
				const extra = yield* overlayOnlyNames(
					documents,
					path,
					entries.map((entry) => entry.name),
				);
				return extra.length === 0
					? entries
					: [...entries, ...extra.map((name): FileSystem.DirectoryEntry => ({ name, type: "File" }))];
			}),
	});

/** Names of open documents directly under `path` that `listed` does not already hold. */
const overlayOnlyNames = (
	documents: OverlayDocumentsShape,
	path: string,
	listed: ReadonlyArray<string>,
): Effect.Effect<Array<string>> =>
	Effect.map(documents.entries(), (entries) => {
		const directory = trimTrailingSeparators(path);
		return entries
			.map(([key]) => parentAndName(key))
			.filter(([parent, name]) => parent === directory && !listed.includes(name))
			.map(([, name]) => name);
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
