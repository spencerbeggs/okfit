import { confineReal } from "@effected/walker";
import { Effect, FileSystem, Option, Schema } from "effect";

/**
 * A file read was refused because it does not stay inside the bundle root (OKF 0.3 section 3.2).
 *
 * `reason` says why: `outside` (a link on the path resolves outside the root), `unresolvable` (a link on the path
 * dangles or cannot be resolved) or `changed` (the file that was opened is not the file the path resolves to, so
 * the path was swapped while it was read, or no identity could be compared).
 *
 * @public
 */
export class ConfinementError extends Schema.TaggedError<ConfinementError>()("ConfinementError", {
	root: Schema.String,
	/** The path that was read, as it was given. */
	path: Schema.String,
	reason: Schema.Literals(["outside", "unresolvable", "changed"]),
}) {
	override get message(): string {
		return this.reason === "outside"
			? `"${this.path}" resolves outside the bundle root "${this.root}"`
			: this.reason === "unresolvable"
				? `"${this.path}" could not be resolved, so it cannot be shown to stay inside the bundle root "${this.root}"`
				: `"${this.path}" changed while it was read, so it cannot be shown to stay inside the bundle root "${this.root}"`;
	}
}

const CHUNK = 64 * 1024;

/**
 * Read the file `target` (an absolute path) under `root` confined to it, closing the gap a check followed by a
 * read leaves open: open the file, resolve the path with `confineReal` (every link on it, at the file or at a
 * directory above it), then require that the open file is the file the resolved path names (`dev` and `ino` of
 * the open file's `stat` against `lstat` of the real path, which must itself be a file and not a link). The bytes come from the open file, never from a second
 * open of the path, so a path swapped for a link out after the check cannot be read.
 *
 * It fails with {@link ConfinementError} when the path leaves the root, dangles, or names a different file than
 * the one opened (or when either stat lacks an `ino`), and with the `PlatformError` of the open or the read
 * otherwise. A missing file is that `PlatformError` (`NotFound`) unless a link on its path escapes or dangles, which
 * is a {@link ConfinementError}. A hard link to a file under the root is a file under the root (OKF 0.3 section
 * 3.2) and is read.
 *
 * Only reads are confined this way. A write stays a check followed by `writeAtomic`.
 *
 * @public
 */
export const readConfinedBytes = Effect.fn("okfit/ConfinedRead/readConfinedBytes")(function* (
	root: string,
	target: string,
) {
	const fs = yield* FileSystem.FileSystem;
	const refuse = (reason: ConfinementError["reason"]) => new ConfinementError({ root, path: target, reason });
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const opened = yield* Effect.result(fs.open(target));
			if (opened._tag === "Failure") {
				// A dangling link, or a missing file under a link that leaves the root, is an escape, not an absence.
				const refused = yield* confineReal(root, target).pipe(
					Effect.match({ onFailure: (error) => error.reason, onSuccess: () => undefined }),
				);
				if (refused !== undefined) return yield* refuse(refused === "outside" ? "outside" : "unresolvable");
				return yield* Effect.fail(opened.failure);
			}
			const file = opened.success;
			const real = yield* confineReal(root, target).pipe(
				Effect.mapError((error) => refuse(error.reason === "outside" ? "outside" : "unresolvable")),
			);
			const held = yield* file.stat;
			const named = yield* fs.lstat(real).pipe(Effect.mapError(() => refuse("changed")));
			if (held.dev !== named.dev || !Option.isSome(held.ino) || !Option.isSome(named.ino))
				return yield* refuse("changed");
			if (held.ino.value !== named.ino.value) return yield* refuse("changed");
			const chunks: Array<Uint8Array> = [];
			let length = 0;
			for (;;) {
				const chunk = yield* file.readAlloc(CHUNK);
				if (Option.isNone(chunk)) break;
				chunks.push(chunk.value);
				length += chunk.value.length;
			}
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.length;
			}
			return bytes;
		}),
	);
});

/**
 * {@link readConfinedBytes} decoded as UTF-8. A leading byte-order mark is dropped, as Node's `readFileString`
 * drops it, so the loader reads a BOM file as it always did and a writer gives the BOM back.
 *
 * @public
 */
export const readConfinedString = Effect.fn("okfit/ConfinedRead/readConfinedString")(function* (
	root: string,
	target: string,
) {
	const bytes = yield* readConfinedBytes(root, target);
	return new TextDecoder("utf-8").decode(bytes);
});
