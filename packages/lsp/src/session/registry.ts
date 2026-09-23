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
	/**
	 * Disposes a folder's current entry (running `onDispose` on its old handle,
	 * if it had one) and builds a fresh one through the same path `sessionFor`
	 * uses, so a config that fails to load is recorded as a failure and
	 * retried later exactly as today. Returns the new handle, or `None` when
	 * the rebuild itself failed.
	 */
	readonly rebuild: (folder: string) => Effect.Effect<Option.Option<SessionHandle>>;
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
	/** Threaded straight to `makeScheduler`'s `SchedulerOptions.maxWait` for every session this registry builds. */
	readonly maxWait: Duration.Input;
	/** Called by the scheduler for a session; the registry owns neither publishing nor `now`. */
	readonly onRevalidate: (handle: SessionHandle, tier: RevalidateTier) => Effect.Effect<void>;
	/**
	 * Called with a folder's old handle whenever that folder's entry is
	 * disposed with a live session -- `removeFolders`, `setFolders` dropping
	 * it, and `rebuild` -- so the caller can clear whatever it published for
	 * that session. Never called for a folder whose cached entry had no
	 * handle (a failed config).
	 */
	readonly onDispose: (oldHandle: SessionHandle) => Effect.Effect<void>;
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
 * **Lock order.** The single `gate` semaphore guards only the cache map's
 * reads and writes (`entryFor`'s check-and-insert, `takeEntry`'s
 * read-and-delete, `rebuild`'s read and its later swap-in) -- never a
 * disposed entry's cleanup. `Scope.close` and `onDispose` (both potentially
 * slow: `Scope.close` awaits an in-flight publish's chain fiber, `onDispose`
 * is transport I/O) always run with the gate released, so disposing one
 * folder never stalls `sessionFor`/`entryFor` for another. `rebuild` swaps
 * the fresh entry in before disposing the old one, and never removes the
 * folder from the cache in between, so a `sessionFor` racing the same folder
 * mid-rebuild finds the outgoing (still valid) session instead of a miss --
 * this is what keeps a per-folder lock unnecessary for the map-only critical
 * section to be correct.
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

		/**
		 * Reads and removes a folder's cache entry as one gated step (`undefined`
		 * for a folder never built); cleanup (`Scope.close`, `onDispose`) is the
		 * caller's job, run outside the gate. Lock order: the gate guards only
		 * this map mutation, never the disposal that follows it.
		 */
		const takeEntry = (folder: string): Effect.Effect<CacheEntry | undefined> =>
			gate.withPermit(
				Effect.gen(function* () {
					const entry = (yield* Ref.get(cache)).get(folder);
					if (entry === undefined) return undefined;
					yield* Ref.update(cache, (map) => {
						const next = new Map(map);
						next.delete(folder);
						return next;
					});
					return entry;
				}),
			);

		/**
		 * Closes an entry's scope (if it owns one) and runs `onDispose` on its
		 * handle (if it had a live session), outside the gate: both can be slow
		 * (`Scope.close` awaits an in-flight publish's chain fiber; `onDispose`
		 * is transport I/O), and neither must stall an unrelated folder's
		 * `sessionFor`/`entryFor`. Returns the old handle, or `None` for
		 * `undefined` or a cached config failure (which owns no scope or handle).
		 */
		const cleanupEntry = (entry: CacheEntry | undefined): Effect.Effect<Option.Option<SessionHandle>> =>
			Effect.gen(function* () {
				if (entry === undefined) return Option.none();
				if (Option.isSome(entry.scope)) {
					yield* Scope.close(entry.scope.value, Exit.void);
				}
				if (Option.isSome(entry.handle)) {
					yield* options.onDispose(entry.handle.value);
				}
				return entry.handle;
			});

		/**
		 * Removes a folder's cache entry (gated) and disposes it (ungated): for
		 * `removeFolders`/`setFolders` and the shutdown finalizer, none of which
		 * need the folder to keep a (even briefly stale) entry the way
		 * {@link rebuild} does.
		 */
		const disposeFolder = (folder: string): Effect.Effect<void> =>
			Effect.asVoid(Effect.flatMap(takeEntry(folder), cleanupEntry));

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
						maxWait: options.maxWait,
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

		/**
		 * Builds a fresh entry for `folder` and swaps it into the cache in
		 * place of whatever was there, then disposes the old one (`onDispose`
		 * runs on its old handle, if it had one); a failed rebuild is cached
		 * and retried later exactly as today.
		 *
		 * Lock order, deliberately never a per-folder lock: the gate is taken
		 * twice, briefly, once to read the previous entry and once to install
		 * the new one -- never held across `buildEntry` (config resolution and
		 * `BundleSession.make`, both I/O) or the old entry's cleanup
		 * (`Scope.close`/`onDispose`, run only after the swap). Between the two
		 * gated steps the folder's cache entry is the OUTGOING one, not absent:
		 * a `sessionFor`/`entryFor` call racing this same folder during a
		 * rebuild sees a valid, still-functioning session and uses it, rather
		 * than finding a miss and starting its own concurrent build (which the
		 * map-only critical section could not otherwise prevent without a
		 * per-folder lock). The old scope is closed and `onDispose` has
		 * completed before this returns, so a caller that schedules a full
		 * revalidate on the returned handle right after `rebuild` resolves is
		 * guaranteed the old session's diagnostics were already cleared.
		 */
		const rebuild = (folder: string): Effect.Effect<Option.Option<SessionHandle>> =>
			Effect.gen(function* () {
				const previous = yield* gate.withPermit(Effect.map(Ref.get(cache), (map) => map.get(folder)));
				const built = yield* buildEntry(folder);
				yield* gate.withPermit(
					Ref.update(cache, (map) => {
						const next = new Map(map);
						next.set(folder, built);
						return next;
					}),
				);
				yield* cleanupEntry(previous);
				return built.handle;
			});

		const setFolders = (next: ReadonlyArray<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const nextSet = new Set(next);
				const previous = yield* Ref.get(folders);
				const removed = [...previous].filter((folder) => !nextSet.has(folder));
				yield* Effect.forEach(removed, disposeFolder, { discard: true });
				yield* Effect.forEach(removed, forgetLogged, { discard: true });
				yield* Ref.set(folders, nextSet);
			});

		const addFolders = (added: ReadonlyArray<string>): Effect.Effect<void> =>
			Ref.update(folders, (current) => new Set([...current, ...added]));

		const removeFolders = (removed: ReadonlyArray<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				yield* Effect.forEach(removed, disposeFolder, { discard: true });
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
				yield* Effect.forEach([...map.keys()], disposeFolder, { discard: true });
			}),
		);

		return { setFolders, addFolders, removeFolders, sessionFor, sessions, retryFailed, rebuild };
	});
