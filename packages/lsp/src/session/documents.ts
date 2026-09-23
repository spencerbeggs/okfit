/**
 * Open-document memory: what the diagnostics feature remembers about a
 * document's editor buffer across a session rebuild.
 *
 * @packageDocumentation
 */
import { Effect, Option, Ref } from "effect";
import { isUnder } from "../internal/paths.js";

/** An open document's overlay text and version, as last recorded by `record`. @public */
export interface OpenDocument {
	readonly text: string;
	readonly version: number;
}

/**
 * The read side of the open-document memory: what an edit-computing feature
 * (code actions, commands) reads to compute against the editor's current
 * buffer rather than the last-revalidated snapshot.
 *
 * @public
 */
export interface OpenDocuments {
	/** `path`'s overlay as last recorded, or `None` when `path` is not open. */
	readonly get: (path: string) => Effect.Effect<Option.Option<OpenDocument>>;
}

/**
 * A registry-wide (not per-folder) memory of every open document's overlay,
 * keyed by absolute path. Ownership of a path shifts with the workspace
 * folder set, so this memory is not scoped to a folder itself; `openUnder`
 * filters by prefix at read time instead.
 *
 * @internal
 */
export interface DocumentMemoryShape extends OpenDocuments {
	/** Records (or replaces) `path`'s overlay. */
	readonly record: (path: string, text: string, version: number) => Effect.Effect<void>;
	/** Forgets `path`; a no-op if it was not recorded. */
	readonly forget: (path: string) => Effect.Effect<void>;
	/** Every recorded document whose path is `root` itself or under it, as `[path, document]` pairs. */
	readonly openUnder: (root: string) => Effect.Effect<ReadonlyArray<readonly [string, OpenDocument]>>;
}

/**
 * Builds a {@link DocumentMemoryShape} over a fresh `Ref`.
 *
 * @internal
 */
export const makeDocumentMemory = (): Effect.Effect<DocumentMemoryShape> =>
	Effect.gen(function* () {
		const ref = yield* Ref.make<ReadonlyMap<string, OpenDocument>>(new Map());

		const record = (path: string, text: string, version: number): Effect.Effect<void> =>
			Ref.update(ref, (map) => new Map(map).set(path, { text, version }));

		const forget = (path: string): Effect.Effect<void> =>
			Ref.update(ref, (map) => {
				if (!map.has(path)) return map;
				const next = new Map(map);
				next.delete(path);
				return next;
			});

		const openUnder = (root: string): Effect.Effect<ReadonlyArray<readonly [string, OpenDocument]>> =>
			Effect.map(Ref.get(ref), (map) => [...map.entries()].filter(([path]) => isUnder(root, path)));

		const get = (path: string): Effect.Effect<Option.Option<OpenDocument>> =>
			Effect.map(Ref.get(ref), (map) => Option.fromNullishOr(map.get(path)));

		return { record, forget, openUnder, get };
	});
