import { confineReal } from "@effected/walker";
import { Effect, FileSystem, Option, Schema } from "effect";

/**
 * A file read was refused (OKF 0.3 section 3.2).
 *
 * `reason` says why: `outside` (a link on the path resolves outside the root), `unresolvable` (a link on the path
 * dangles or cannot be resolved) or `changed` (the path no longer names the file that was opened, or what it names
 * could not be compared: it was swapped, replaced or removed while it was read, so reading again may succeed). Only
 * `outside` and `unresolvable` mean the path leaves the bundle; `changed` is transient and never an escape verdict.
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
				: `"${this.path}" changed while it was read; try again`;
	}
}

const CHUNK = 64 * 1024;

/**
 * Read the file `target` (an absolute path) under `root` confined to it, so a link swapped in after a check is not
 * read: open the file, resolve the path with `confineReal` (every link on it, at the file or at a directory above
 * it), require that the path still exists (`realPath`), then require that the open file is the file the resolved
 * path names (`dev` and `ino` of the open file's `stat` against `lstat` of the real path, which must itself be a
 * file and not a link). The bytes come from the open file, never from a second open of the path.
 *
 * The guarantee is exact about one case: a link at the file itself, swapped in at any moment during the read, is
 * refused. A race through a directory above the file can still win, because the open and the resolution are
 * separate steps on the path (spencerbeggs/okfit#524); there is no retry, which would only widen that window.
 *
 * It fails with {@link ConfinementError} (`outside` or `unresolvable` when a link on the path leaves the root or
 * dangles; `changed` when the path no longer names the file that was opened, or either stat lacks an `ino`), and
 * with the `PlatformError` of the open or the read otherwise. A missing file is that `PlatformError` (`NotFound`)
 * unless a link on its path escapes or dangles. A hard link to a file under the root is a file under the root
 * (OKF 0.3 section 3.2) and is read.
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
			// The open succeeded, so the path exists: `confineReal` resolves a missing tail lexically, which means the
			// file is gone (or was never at this path) now, and what was opened is not what the path names. A second
			// resolution must also land where `confineReal` did: a link above the file swapped between the two samples
			// resolves elsewhere, and that is a path that changed under the read.
			const again = yield* fs.realPath(target).pipe(Effect.mapError(() => refuse("changed")));
			if (again !== real) return yield* refuse("changed");
			const held = yield* file.stat;
			const named = yield* fs.lstat(real).pipe(Effect.mapError(() => refuse("changed")));
			if (named.type !== "File") return yield* refuse("changed");
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
 * {@link readConfinedBytes} decoded as UTF-8. A leading byte-order mark is dropped, as Effect's
 * `FileSystem.readFileString` (a `TextDecoder`) drops it, so the loader reads a BOM file as it always did and a
 * writer gives the BOM back.
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
