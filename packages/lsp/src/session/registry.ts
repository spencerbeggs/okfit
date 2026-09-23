import type { Git } from "@effected/git";
import type { AppDirs, Xdg } from "@effected/xdg";
import type { BundleSessionShape, RevalidateTier } from "@okfit/engine";
import { BundleSession, provideConfig, resolveProjectConfig } from "@okfit/engine";
import type { GitHistory } from "@okfit/profiles";
import type { Crypto, Duration, FileSystem, Path } from "effect";
import { Context, Effect, Exit, Option, Ref, Result, Scope, Semaphore } from "effect";
import { messageOf } from "../internal/messageOf.js";
import type { Scheduler } from "./scheduler.js";
import { makeScheduler } from "./scheduler.js";

/**
 * One workspace folder's live session: the folder itself, its resolved
 * bundle root, the built `BundleSession`, and the scheduler a feature
 * calls into to debounce a revalidate for it.
 *
 * @public
 */
export interface SessionHandle {
	/** Absolute workspace folder. */
	readonly folder: string;
	/** Absolute, resolved bundle root. */
	readonly bundleRoot: string;
	readonly session: BundleSessionShape;
	readonly scheduler: Scheduler;
}

/**
 * Options for {@link SessionRegistryShape.sessionFor}.
 *
 * @public
 */
export interface SessionForOptions {
	/**
	 * Rebuild the owning folder's entry when its last build failed (a config
	 * that did not load) instead of answering from the cached failure. The
	 * full-tier document events (`open`, `save`) set it; an edit does not.
	 */
	readonly retryFailed?: boolean;
}

/**
 * The registry a protocol handler drives: workspace folders in, sessions
 * out. Folder set changes never build a session eagerly; a session is
 * built the first time `sessionFor` needs it.
 *
 * @public
 */
export interface SessionRegistryShape {
	/** Absolute paths; replaces the whole folder set. Folders no longer present are disposed. */
	readonly setFolders: (folders: ReadonlyArray<string>) => Effect.Effect<void>;
	/** Absolute paths; adds folders lazily, no eager build. */
	readonly addFolders: (folders: ReadonlyArray<string>) => Effect.Effect<void>;
	/** Absolute paths; disposes their sessions. */
	readonly removeFolders: (folders: ReadonlyArray<string>) => Effect.Effect<void>;
	/** The session owning an absolute document path, if the path is under a workspace folder whose bundle root contains it. */
	readonly sessionFor: (path: string, options?: SessionForOptions) => Effect.Effect<Option.Option<SessionHandle>>;
	/** Every live session (for watched-files fan-out). */
	readonly sessions: Effect.Effect<ReadonlyArray<SessionHandle>>;
	/** Absolute paths; rebuilds every workspace folder whose last build failed and that contains one of them, returning the sessions that now build. */
	readonly retryFailed: (paths: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<SessionHandle>>;
	/** Forget a folder's cached session (config changed); the next sessionFor rebuilds it. */
	readonly invalidate: (folder: string) => Effect.Effect<void>;
}

/**
 * Service tag for {@link SessionRegistryShape}.
 *
 * @public
 */
export class SessionRegistry extends Context.Service<SessionRegistry, SessionRegistryShape>()(
	"@okfit/lsp/SessionRegistry",
) {}

/**
 * Constructor options for {@link makeSessionRegistry}.
 *
 * @public
 */
export interface SessionRegistryOptions {
	readonly delay: Duration.Input;
	/** Called by the scheduler for a session; the registry owns neither publishing nor `now`. */
	readonly onRevalidate: (handle: SessionHandle, tier: RevalidateTier) => Effect.Effect<void>;
}

/**
 * Every service {@link makeSessionRegistry} and the sessions it builds need.
 *
 * @public
 */
export type SessionRegistryServices =
	| FileSystem.FileSystem
	| Path.Path
	| AppDirs
	| Xdg
	| Git
	| GitHistory
	| Crypto.Crypto;

/** One folder's cache entry: the built handle (if config resolution and `BundleSession.make` succeeded) plus the scope it owns, if any -- a failed config resolution builds no scope. */
interface CacheEntry {
	readonly handle: Option.Option<SessionHandle>;
	readonly scope: Option.Option<Scope.Closeable>;
}

/** Whether `path` is `folder` itself or under it. */
const isUnder = (folder: string, path: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** The longest folder in `folders` that `path` is under (`path === folder` or `path.startsWith(folder + "/")`), else `None`. */
const ownerOf = (folders: ReadonlySet<string>, path: string): Option.Option<string> => {
	let owner: string | undefined;
	for (const folder of folders) {
		if (isUnder(folder, path)) {
			if (owner === undefined || folder.length > owner.length) {
				owner = folder;
			}
		}
	}
	return owner === undefined ? Option.none() : Option.some(owner);
};

/**
 * Builds a {@link SessionRegistryShape}: workspace folders map to one engine
 * `BundleSession` per bundle root, lazily. A folder's session is built on
 * first use (`sessionFor`, never `setFolders`/`addFolders`). A folder whose
 * config fails to load caches the failure; `sessionFor` with `retryFailed`
 * and `retryFailed` rebuild it, so fixing the config recovers the folder. A
 * failure is logged only when its message differs from the last one logged
 * for that folder, so a folder that stays broken costs one log line, not
 * one per retry.
 *
 * @public
 */
export const makeSessionRegistry = (
	options: SessionRegistryOptions,
): Effect.Effect<SessionRegistryShape, never, SessionRegistryServices | Scope.Scope> =>
	Effect.gen(function* () {
		// Captured once so the closures below (`sessionFor`, `sessions`, ...)
		// need no services at call time, matching `SessionRegistryShape`'s
		// bare `Effect.Effect<...>` (R = never) signatures; only building a
		// folder's session (`buildEntry`) actually reads these services.
		const context = yield* Effect.context<SessionRegistryServices>();
		const folders = yield* Ref.make<ReadonlySet<string>>(new Set());
		const cache = yield* Ref.make<ReadonlyMap<string, CacheEntry>>(new Map());
		const gate = yield* Semaphore.make(1);
		/** The last config failure logged per folder; cleared when the folder builds or is removed. */
		const lastLogged = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

		const forgetLogged = (folder: string): Effect.Effect<void> =>
			Ref.update(lastLogged, (map) => {
				if (!map.has(folder)) return map;
				const next = new Map(map);
				next.delete(folder);
				return next;
			});

		/** Close (if it owns a scope) and drop a folder's cache entry, if any; a no-op for a folder never built. */
		const invalidate = (folder: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				const entry = (yield* Ref.get(cache)).get(folder);
				yield* Ref.update(cache, (map) => {
					const next = new Map(map);
					next.delete(folder);
					return next;
				});
				if (entry !== undefined && Option.isSome(entry.scope)) {
					yield* Scope.close(entry.scope.value, Exit.void);
				}
			});

		const buildEntry = (folder: string): Effect.Effect<CacheEntry> =>
			Effect.gen(function* () {
				const resolved = yield* Effect.result(
					resolveProjectConfig({
						pathArg: Option.none(),
						explicitConfigPath: Option.none(),
						cwd: folder,
					}).pipe(provideConfig({ explicitConfigPath: Option.none(), discoveryCwd: folder })),
				);

				if (Result.isFailure(resolved)) {
					const message = messageOf(resolved.failure);
					const previous = (yield* Ref.get(lastLogged)).get(folder);
					if (previous !== message) {
						yield* Effect.logWarning(`okfit-lsp: no bundle for ${folder}: ${message}`);
						yield* Ref.update(lastLogged, (map) => new Map(map).set(folder, message));
					}
					return { handle: Option.none(), scope: Option.none() };
				}
				yield* forgetLogged(folder);

				const config = resolved.success;
				const folderScope = yield* Scope.make();
				const session = yield* BundleSession.make({
					root: config.bundleRoot,
					config: config.config,
					profile: config.profile,
				});
				// `handleBox` breaks the circular reference between the scheduler's
				// `run` callback (needs the handle it is part of) and the handle
				// (needs the scheduler): `run` is only ever invoked after
				// `buildEntry` returns and `handleBox.handle` is set, since a
				// schedule is never triggered from inside `buildEntry` itself.
				const handleBox: { handle: SessionHandle | undefined } = { handle: undefined };
				const scheduler = yield* Effect.provideService(
					Scope.Scope,
					folderScope,
				)(
					makeScheduler({
						delay: options.delay,
						run: (tier) => options.onRevalidate(handleBox.handle as SessionHandle, tier),
					}),
				);
				const handle: SessionHandle = { folder, bundleRoot: config.bundleRoot, session, scheduler };
				handleBox.handle = handle;
				return { handle: Option.some(handle), scope: Option.some(folderScope) };
			}).pipe(Effect.provideContext(context));

		/** The folder's cached entry, built on a miss; a cached failure is rebuilt too when `retry` is set (it owns no scope to close). */
		const entryFor = (folder: string, retry: boolean): Effect.Effect<CacheEntry> =>
			gate.withPermit(
				Effect.gen(function* () {
					const existing = (yield* Ref.get(cache)).get(folder);
					if (existing !== undefined && (Option.isSome(existing.handle) || !retry)) return existing;
					const built = yield* buildEntry(folder);
					yield* Ref.update(cache, (map) => {
						const next = new Map(map);
						next.set(folder, built);
						return next;
					});
					return built;
				}),
			);

		const setFolders = (next: ReadonlyArray<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const nextSet = new Set(next);
				const previous = yield* Ref.get(folders);
				const removed = [...previous].filter((folder) => !nextSet.has(folder));
				yield* Effect.forEach(removed, invalidate, { discard: true });
				yield* Effect.forEach(removed, forgetLogged, { discard: true });
				yield* Ref.set(folders, nextSet);
			});

		const addFolders = (added: ReadonlyArray<string>): Effect.Effect<void> =>
			Ref.update(folders, (current) => new Set([...current, ...added]));

		const removeFolders = (removed: ReadonlyArray<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				yield* Effect.forEach(removed, invalidate, { discard: true });
				yield* Effect.forEach(removed, forgetLogged, { discard: true });
				yield* Ref.update(folders, (current) => {
					const next = new Set(current);
					for (const folder of removed) next.delete(folder);
					return next;
				});
			});

		const sessionFor = (
			path: string,
			sessionOptions: SessionForOptions = {},
		): Effect.Effect<Option.Option<SessionHandle>> =>
			Effect.gen(function* () {
				const currentFolders = yield* Ref.get(folders);
				const owner = ownerOf(currentFolders, path);
				if (Option.isNone(owner)) return Option.none();
				const entry = yield* entryFor(owner.value, sessionOptions.retryFailed === true);
				if (Option.isNone(entry.handle)) return Option.none();
				const handle = entry.handle.value;
				if (path !== handle.bundleRoot && !path.startsWith(`${handle.bundleRoot}/`)) return Option.none();
				return Option.some(handle);
			});

		const sessions: Effect.Effect<ReadonlyArray<SessionHandle>> = Effect.map(Ref.get(cache), (map) =>
			[...map.values()].flatMap((entry) => (Option.isSome(entry.handle) ? [entry.handle.value] : [])),
		);

		const retryFailed = (paths: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<SessionHandle>> =>
			Effect.gen(function* () {
				const currentFolders = yield* Ref.get(folders);
				const map = yield* Ref.get(cache);
				const failed = [...map.entries()]
					.filter(
						([folder, entry]) =>
							Option.isNone(entry.handle) && currentFolders.has(folder) && paths.some((path) => isUnder(folder, path)),
					)
					.map(([folder]) => folder);
				const rebuilt = yield* Effect.forEach(failed, (folder) => entryFor(folder, true));
				return rebuilt.flatMap((entry) => (Option.isSome(entry.handle) ? [entry.handle.value] : []));
			});

		yield* Effect.addFinalizer(() =>
			Effect.gen(function* () {
				const map = yield* Ref.get(cache);
				yield* Effect.forEach([...map.keys()], invalidate, { discard: true });
			}),
		);

		return { setFolders, addFolders, removeFolders, sessionFor, sessions, retryFailed, invalidate };
	});
