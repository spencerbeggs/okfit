import type { Git } from "@effected/git";
import type { AppDirs, Xdg } from "@effected/xdg";
import type { BundleSessionShape, ResolvedProjectConfig, RevalidateTier } from "@okfit/engine";
import { BundleSession, provideConfig, resolveProjectConfig } from "@okfit/engine";
import type { GitHistory } from "@okfit/profiles";
import type { Crypto, Duration, FileSystem, Path } from "effect";
import { Context, Deferred, Effect, Exit, Option, Ref, Result, Scope } from "effect";
import { messageOf } from "../internal/messageOf.js";
import { isUnder } from "../internal/paths.js";
import type { Scheduler } from "./scheduler.js";
import { makeScheduler } from "./scheduler.js";

/**
 * One bundle root's live session: its resolved bundle root, the built
 * `BundleSession`, the scheduler a feature calls into to debounce a
 * revalidate for it, and the workspace folder whose build created it.
 *
 * @public
 */
export interface SessionHandle {
	/**
	 * Absolute workspace folder whose config resolution built this session.
	 * Several folders can resolve to one bundle root and share this handle;
	 * this is the first of them, which may since have been removed while
	 * another keeps the session alive. Informational only: the registry keys
	 * by `bundleRoot`.
	 */
	readonly folder: string;
	/** Absolute, resolved bundle root; the registry's key for this session. */
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
 * The registry a protocol handler drives: workspace folders in, one session
 * per bundle root out. Folder set changes never build a session eagerly; a
 * folder is resolved the first time `sessionFor` needs it.
 *
 * @public
 */
export interface SessionRegistryShape {
	/** Absolute paths; replaces the whole folder set. A bundle root no remaining folder resolves to is disposed. */
	readonly setFolders: (folders: ReadonlyArray<string>) => Effect.Effect<void>;
	/** Absolute paths; adds folders lazily, no eager build. */
	readonly addFolders: (folders: ReadonlyArray<string>) => Effect.Effect<void>;
	/** Absolute paths; drops the folders, disposing each bundle root whose last folder this was. */
	readonly removeFolders: (folders: ReadonlyArray<string>) => Effect.Effect<void>;
	/** The session owning an absolute document path, if the path is under a workspace folder whose bundle root contains it. */
	readonly sessionFor: (path: string, options?: SessionForOptions) => Effect.Effect<Option.Option<SessionHandle>>;
	/** Every live session, one per bundle root however many folders share it (for watched-files fan-out). */
	readonly sessions: Effect.Effect<ReadonlyArray<SessionHandle>>;
	/** Absolute paths; rebuilds every workspace folder whose last build failed and that contains one of them, returning the sessions that now serve them (each once). */
	readonly retryFailed: (paths: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<SessionHandle>>;
	/**
	 * Rebuilds the session for `bundleRoot` once, however many folders share
	 * it: every folder mapped to it re-resolves its config, the fresh
	 * session(s) are swapped in, and only then is the old one disposed
	 * (running `onDispose` on its handle). A folder whose config now fails to
	 * load is recorded as a failure and retried later exactly like any other
	 * failed build. Returns the fresh handles installed (normally one; none
	 * when every folder failed, or when `bundleRoot` has no live session).
	 *
	 * Invariant a caller must keep: nothing schedules a revalidate on a
	 * returned handle until `rebuild` has resolved. The publisher's memory is
	 * keyed by bundle root, which the old and new sessions share, and
	 * `onDispose` clears that root; a publish from the new session before the
	 * clear would be wiped or answered with a spurious empty set.
	 */
	readonly rebuild: (bundleRoot: string) => Effect.Effect<ReadonlyArray<SessionHandle>>;
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
	 * Called with a bundle root's old handle whenever its session is disposed
	 * -- `removeFolders` or `setFolders` dropping the last folder that maps to
	 * it, and `rebuild` -- so the caller can clear whatever it published for
	 * that session. Called once per session, never per folder.
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

/** A built session and the scope that owns its scheduler. */
interface Built {
	readonly handle: SessionHandle;
	readonly scope: Scope.Closeable;
}

/** One bundle root's live session plus the workspace folders resolving to it; the entry is disposed when `folders` empties. */
interface RootEntry extends Built {
	readonly folders: ReadonlySet<string>;
}

/**
 * A registered workspace folder's state: not resolved yet, being resolved
 * (callers await `done` instead of starting a second build), resolved to a
 * config that failed to load, or resolved to a live bundle root.
 */
type FolderSlot =
	| { readonly _tag: "Unbuilt" }
	| { readonly _tag: "Building"; readonly done: Deferred.Deferred<void> }
	| { readonly _tag: "Failed" }
	| { readonly _tag: "Live"; readonly root: string };

/** The registry's whole state; the keys of `folders` are the workspace folder set. */
interface State {
	readonly folders: ReadonlyMap<string, FolderSlot>;
	readonly roots: ReadonlyMap<string, RootEntry>;
}

const UNBUILT: FolderSlot = { _tag: "Unbuilt" };
const FAILED: FolderSlot = { _tag: "Failed" };

/** The longest folder in `folders` that `path` is under (`path === folder` or `path.startsWith(folder + "/")`), else `None`. */
const ownerOf = (folders: Iterable<string>, path: string): Option.Option<string> => {
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

/** `state` with `removed` dropped from the folder set, plus every root entry whose last folder that was (to dispose). */
const withoutFolders = (state: State, removed: Iterable<string>): readonly [ReadonlyArray<RootEntry>, State] => {
	const folders = new Map(state.folders);
	const roots = new Map(state.roots);
	const disposed: Array<RootEntry> = [];
	for (const folder of removed) {
		const slot = folders.get(folder);
		if (slot === undefined) continue;
		folders.delete(folder);
		if (slot._tag !== "Live") continue;
		const entry = roots.get(slot.root);
		if (entry === undefined) continue;
		const remaining = new Set(entry.folders);
		remaining.delete(folder);
		if (remaining.size === 0) {
			roots.delete(slot.root);
			disposed.push(entry);
		} else {
			roots.set(slot.root, { ...entry, folders: remaining });
		}
	}
	return [disposed, { folders, roots }];
};

/**
 * Builds a {@link SessionRegistryShape}: workspace folders map onto one
 * engine `BundleSession` per resolved bundle root, lazily. Two folders
 * resolving to the same root (a repository and its `okf/` directory, say)
 * share one session: the root entry reference-counts the folders mapped to
 * it and is disposed only when the last of them goes. A folder is resolved
 * on first use (`sessionFor`, never `setFolders`/`addFolders`). A folder
 * whose config fails to load caches the failure; `sessionFor` with
 * `retryFailed` and `retryFailed` rebuild it, so fixing the config recovers
 * the folder. A failure is logged only when its message differs from the
 * last one logged for that folder.
 *
 * **Atomicity and lock order.** All state lives in one `Ref` and every
 * transition is a single synchronous `Ref.modify`, so no lock is ever held
 * across I/O. Config resolution and `BundleSession.make` run outside it: a
 * folder being built holds a `Building` placeholder whose `Deferred`
 * concurrent callers for that folder await, while callers for any other
 * folder proceed untouched. Cleanup -- `Scope.close` (which awaits an
 * in-flight publish's chain fiber) and `onDispose` (transport I/O) -- always
 * runs after the transition that detached the entry, on exactly the entry
 * that transition removed. `rebuild` swaps the fresh entry in before
 * disposing the old one, and the folders keep pointing at the outgoing
 * session until that swap, so a `sessionFor` racing a rebuild finds a valid
 * session instead of a miss.
 *
 * @public
 */
export const makeSessionRegistry = (
	options: SessionRegistryOptions,
): Effect.Effect<SessionRegistryShape, never, SessionRegistryServices | Scope.Scope> =>
	Effect.gen(function* () {
		// Captured once so the closures below need no services at call time,
		// matching `SessionRegistryShape`'s bare `Effect.Effect<...>` (R = never)
		// signatures; only resolving and building a session reads these services.
		const context = yield* Effect.context<SessionRegistryServices>();
		const state = yield* Ref.make<State>({ folders: new Map(), roots: new Map() });
		/** The last config failure logged per folder; cleared when the folder builds or is removed. */
		const lastLogged = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

		const forgetLogged = (folder: string): Effect.Effect<void> =>
			Ref.update(lastLogged, (map) => {
				if (!map.has(folder)) return map;
				const next = new Map(map);
				next.delete(folder);
				return next;
			});

		/** Closes a disposed root entry's scope, then runs `onDispose` on its handle. */
		const disposeEntry = (entry: RootEntry): Effect.Effect<void> =>
			Effect.andThen(Scope.close(entry.scope, Exit.void), options.onDispose(entry.handle));

		/** Closes a built session that never got installed (it never published, so no `onDispose`). */
		const discard = (built: Built): Effect.Effect<void> => Scope.close(built.scope, Exit.void);

		/** Resolves `folder`'s config; a failure is logged (once per distinct message) and answered `None`. */
		const resolveFolder = (folder: string): Effect.Effect<Option.Option<ResolvedProjectConfig>> =>
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
					return Option.none();
				}
				yield* forgetLogged(folder);
				return Option.some(resolved.success);
			}).pipe(Effect.provideContext(context));

		/** Builds a session and its scheduler for a resolved config; `folder` is recorded on the handle. */
		const buildSession = (folder: string, config: ResolvedProjectConfig): Effect.Effect<Built> =>
			Effect.gen(function* () {
				const scope = yield* Scope.make();
				const session = yield* BundleSession.make({
					root: config.bundleRoot,
					config: config.config,
					profile: config.profile,
				});
				// `handleBox` breaks the circular reference between the scheduler's
				// `run` callback (needs the handle it is part of) and the handle
				// (needs the scheduler): `run` is only ever invoked after the handle
				// is set, since nothing schedules from inside this build.
				const handleBox: { handle: SessionHandle | undefined } = { handle: undefined };
				const scheduler = yield* Effect.provideService(
					Scope.Scope,
					scope,
				)(
					makeScheduler({
						delay: options.delay,
						maxWait: options.maxWait,
						run: (tier) => options.onRevalidate(handleBox.handle as SessionHandle, tier),
					}),
				);
				const handle: SessionHandle = { folder, bundleRoot: config.bundleRoot, session, scheduler };
				handleBox.handle = handle;
				return { handle, scope };
			}).pipe(Effect.provideContext(context));

		/**
		 * Resolves one folder that holds the `building` placeholder and installs
		 * the outcome, unless the folder was removed or re-slotted meanwhile. A
		 * folder resolving to a root that is already live attaches to it
		 * without building a second session; two folders racing to build the
		 * same root keep the first install and discard the other. Always
		 * releases `building.done`, and an interrupted build reverts the
		 * placeholder to `Unbuilt` so the next caller starts over.
		 */
		const runBuild = (folder: string, building: Extract<FolderSlot, { _tag: "Building" }>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const resolved = yield* resolveFolder(folder);
				const root = Option.isSome(resolved) ? resolved.value.bundleRoot : undefined;
				const alreadyLive = root !== undefined && (yield* Ref.get(state)).roots.has(root);
				const built = Option.isSome(resolved) && !alreadyLive ? yield* buildSession(folder, resolved.value) : undefined;
				const loser = yield* Ref.modify(state, (current): readonly [Built | undefined, State] => {
					if (current.folders.get(folder) !== building) return [built, current];
					const folders = new Map(current.folders);
					if (root === undefined) {
						folders.set(folder, FAILED);
						return [undefined, { ...current, folders }];
					}
					const roots = new Map(current.roots);
					const existing = roots.get(root);
					if (existing !== undefined) {
						roots.set(root, { ...existing, folders: new Set([...existing.folders, folder]) });
						folders.set(folder, { _tag: "Live", root });
						return [built, { folders, roots }];
					}
					if (built === undefined) {
						// The live root this folder meant to attach to was disposed meanwhile: start over.
						folders.set(folder, UNBUILT);
						return [undefined, { ...current, folders }];
					}
					roots.set(root, { ...built, folders: new Set([folder]) });
					folders.set(folder, { _tag: "Live", root });
					return [undefined, { folders, roots }];
				});
				if (loser !== undefined) yield* discard(loser);
			}).pipe(
				Effect.ensuring(
					Effect.andThen(
						Ref.update(state, (current) =>
							current.folders.get(folder) === building
								? { ...current, folders: new Map(current.folders).set(folder, UNBUILT) }
								: current,
						),
						Deferred.succeed(building.done, undefined),
					),
				),
			);

		/**
		 * The live handle serving `folder`, resolving it first when it is
		 * unbuilt (or failed and `retry` is set). A caller finding the folder
		 * mid-build awaits that build rather than starting another, then reads
		 * the outcome without retrying again.
		 */
		const handleFor = (folder: string, retry: boolean): Effect.Effect<Option.Option<SessionHandle>> =>
			Effect.gen(function* () {
				let shouldRetry = retry;
				while (true) {
					const done = yield* Deferred.make<void>();
					const step = yield* Ref.modify(
						state,
						(
							current,
						): readonly [
							(
								| { readonly _tag: "Answer"; readonly handle: Option.Option<SessionHandle> }
								| { readonly _tag: "Wait"; readonly done: Deferred.Deferred<void> }
								| { readonly _tag: "Build"; readonly slot: Extract<FolderSlot, { _tag: "Building" }> }
							),
							State,
						] => {
							const slot = current.folders.get(folder);
							if (slot === undefined) return [{ _tag: "Answer", handle: Option.none() }, current];
							switch (slot._tag) {
								case "Live": {
									const entry = current.roots.get(slot.root);
									return [{ _tag: "Answer", handle: Option.fromNullishOr(entry?.handle) }, current];
								}
								case "Building":
									return [{ _tag: "Wait", done: slot.done }, current];
								case "Failed":
									if (!shouldRetry) return [{ _tag: "Answer", handle: Option.none() }, current];
									break;
								case "Unbuilt":
									break;
							}
							const building = { _tag: "Building", done } as const;
							return [
								{ _tag: "Build", slot: building },
								{ ...current, folders: new Map(current.folders).set(folder, building) },
							];
						},
					);
					if (step._tag === "Answer") return step.handle;
					if (step._tag === "Wait") {
						yield* Deferred.await(step.done);
					} else {
						yield* runBuild(folder, step.slot);
					}
					shouldRetry = false;
				}
			});

		const rebuild = (bundleRoot: string): Effect.Effect<ReadonlyArray<SessionHandle>> =>
			Effect.gen(function* () {
				const entry = (yield* Ref.get(state)).roots.get(bundleRoot);
				if (entry === undefined) return [];
				const folders = [...entry.folders];
				const resolutions = yield* Effect.forEach(folders, (folder) =>
					Effect.map(resolveFolder(folder), (resolved) => [folder, resolved] as const),
				);
				// One fresh session per distinct resolved root, built for the first folder resolving to it.
				const fresh = new Map<string, Built>();
				for (const [folder, resolved] of resolutions) {
					if (Option.isNone(resolved) || fresh.has(resolved.value.bundleRoot)) continue;
					fresh.set(resolved.value.bundleRoot, yield* buildSession(folder, resolved.value));
				}
				const outcome = yield* Ref.modify(
					state,
					(
						current,
					): readonly [
						{
							readonly replaced: RootEntry | undefined;
							readonly installed: ReadonlyArray<SessionHandle>;
							readonly losers: ReadonlyArray<Built>;
						},
						State,
					] => {
						const replaced = current.roots.get(bundleRoot);
						// Disposed, or already rebuilt by someone else, since the read above: this rebuild is stale.
						if (replaced === undefined || replaced.handle !== entry.handle) {
							return [{ replaced: undefined, installed: [], losers: [...fresh.values()] }, current];
						}
						const roots = new Map(current.roots);
						roots.delete(bundleRoot);
						const nextFolders = new Map(current.folders);
						const assigned = new Map<string, Set<string>>();
						const resolvedByFolder = new Map(resolutions);
						for (const folder of replaced.folders) {
							const slot = current.folders.get(folder);
							if (slot === undefined || slot._tag !== "Live" || slot.root !== bundleRoot) continue;
							const resolved = resolvedByFolder.get(folder);
							if (resolved === undefined) {
								// Joined the root after this rebuild read it: it re-resolves on its next use.
								nextFolders.set(folder, UNBUILT);
							} else if (Option.isNone(resolved)) {
								nextFolders.set(folder, FAILED);
							} else {
								const root = resolved.value.bundleRoot;
								assigned.set(root, (assigned.get(root) ?? new Set()).add(folder));
								nextFolders.set(folder, { _tag: "Live", root });
							}
						}
						const installed: Array<SessionHandle> = [];
						const losers: Array<Built> = [];
						for (const [root, built] of fresh) {
							const joining = assigned.get(root);
							const existing = roots.get(root);
							if (joining === undefined) {
								losers.push(built);
							} else if (existing !== undefined) {
								roots.set(root, { ...existing, folders: new Set([...existing.folders, ...joining]) });
								losers.push(built);
							} else {
								roots.set(root, { ...built, folders: joining });
								installed.push(built.handle);
							}
						}
						return [
							{ replaced, installed, losers },
							{ folders: nextFolders, roots },
						];
					},
				);
				if (outcome.replaced !== undefined) yield* disposeEntry(outcome.replaced);
				yield* Effect.forEach(outcome.losers, discard, { discard: true });
				return outcome.installed;
			});

		const dropFolders = (removed: (current: State) => Iterable<string>): Effect.Effect<void> =>
			Effect.gen(function* () {
				const [dropped, disposed] = yield* Ref.modify(
					state,
					(current): readonly [readonly [ReadonlyArray<string>, ReadonlyArray<RootEntry>], State] => {
						const folders = [...removed(current)].filter((folder) => current.folders.has(folder));
						const [disposed, next] = withoutFolders(current, folders);
						return [[folders, disposed], next];
					},
				);
				yield* Effect.forEach(disposed, disposeEntry, { discard: true });
				yield* Effect.forEach(dropped, forgetLogged, { discard: true });
			});

		const addFolders = (added: ReadonlyArray<string>): Effect.Effect<void> =>
			Ref.update(state, (current) => {
				const folders = new Map(current.folders);
				for (const folder of added) if (!folders.has(folder)) folders.set(folder, UNBUILT);
				return { ...current, folders };
			});

		const setFolders = (next: ReadonlyArray<string>): Effect.Effect<void> => {
			const nextSet = new Set(next);
			return Effect.andThen(
				dropFolders((current) => [...current.folders.keys()].filter((folder) => !nextSet.has(folder))),
				addFolders(next),
			);
		};

		const removeFolders = (removed: ReadonlyArray<string>): Effect.Effect<void> => dropFolders(() => removed);

		const sessionFor = (
			path: string,
			sessionOptions: SessionForOptions = {},
		): Effect.Effect<Option.Option<SessionHandle>> =>
			Effect.gen(function* () {
				const owner = ownerOf((yield* Ref.get(state)).folders.keys(), path);
				if (Option.isNone(owner)) return Option.none();
				const handle = yield* handleFor(owner.value, sessionOptions.retryFailed === true);
				if (Option.isNone(handle) || !isUnder(handle.value.bundleRoot, path)) return Option.none();
				return handle;
			});

		const sessions: Effect.Effect<ReadonlyArray<SessionHandle>> = Effect.map(Ref.get(state), (current) =>
			[...current.roots.values()].map((entry) => entry.handle),
		);

		const retryFailed = (paths: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<SessionHandle>> =>
			Effect.gen(function* () {
				const failed = [...(yield* Ref.get(state)).folders.entries()]
					.filter(([folder, slot]) => slot._tag === "Failed" && paths.some((path) => isUnder(folder, path)))
					.map(([folder]) => folder);
				const recovered = yield* Effect.forEach(failed, (folder) => handleFor(folder, true));
				const byRoot = new Map<string, SessionHandle>();
				for (const handle of recovered) {
					if (Option.isSome(handle)) byRoot.set(handle.value.bundleRoot, handle.value);
				}
				return [...byRoot.values()];
			});

		yield* Effect.addFinalizer(() => dropFolders((current) => current.folders.keys()));

		return { setFolders, addFolders, removeFolders, sessionFor, sessions, retryFailed, rebuild };
	});
