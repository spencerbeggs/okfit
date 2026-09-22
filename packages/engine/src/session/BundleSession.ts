import type { Git, GitCommandError, UnknownRefError } from "@effected/git";
import type { BundleLoadError, LinkGraph, LoadedBundle, OkfitConfig } from "@okfit/core";
import { Graph } from "@okfit/core";
import type { GitHistory, GitHistoryError, Profile } from "@okfit/profiles";
import type { Crypto, DateTime, PlatformError } from "effect";
import { Context, Effect, FileSystem, Option, Path, Ref, Semaphore } from "effect";
import { PROJECT_CONFIG_NAMES } from "../init/scaffold.js";
import { OverlayDocuments, makeOverlayFileSystem } from "../overlay/layer.js";
import type { RenderedDiagnostic } from "../render/sort.js";
import { collect, sort } from "../render/sort.js";
import { run } from "../validate/run.js";
import type { DiagnosticsByFile } from "./diff.js";
import { diffDiagnostics, groupByFile } from "./diff.js";
import { withFallbackRange } from "./range.js";

/**
 * One bundle root's fixed inputs; `config` and `profile` come from the caller's
 * `resolveProjectConfig`.
 *
 * @public
 */
export interface BundleSessionOptions {
	readonly root: string;
	readonly config: OkfitConfig;
	readonly profile: Option.Option<Profile>;
}

/**
 * `edit` skips the git tier of the provenance lint (`skipProvenance: true`); `full` runs every tier.
 *
 * @public
 */
export type RevalidateTier = "edit" | "full";

/** @public */
export interface RevalidateOptions {
	/** Read once by the caller per revalidate; the engine never reads a Clock. */
	readonly now: DateTime.Utc;
	readonly tier: RevalidateTier;
}

/** @public */
export interface RevalidateResult {
	/**
	 * Only files whose diagnostic set differs from the previous revalidate, keyed by
	 * bundle-relative posix path (`""` for bundle-level); a file whose set became
	 * empty maps to `[]`. Includes files that are not open.
	 */
	readonly changed: ReadonlyMap<string, ReadonlyArray<RenderedDiagnostic>>;
	readonly bundle: LoadedBundle;
}

/**
 * Exactly `run`'s failure union.
 *
 * @public
 */
export type RevalidateError =
	| BundleLoadError
	| GitHistoryError
	| GitCommandError
	| UnknownRefError
	| PlatformError.PlatformError;

/** @public */
export interface WatchedFilesOutcome {
	/** A config discovery file changed: re-resolve config and replace this session. */
	readonly configChanged: boolean;
}

/**
 * What `BundleSession.make` captures once.
 *
 * @public
 */
export type BundleSessionServices = FileSystem.FileSystem | Path.Path | Git | GitHistory | Crypto.Crypto;

/** @public */
export interface BundleSessionShape {
	/** Absolute, resolved bundle root. */
	readonly root: string;
	/**
	 * Shadow `path` with an editor buffer. A document whose parent directory does
	 * not exist on disk is not walked until that directory exists.
	 */
	readonly open: (path: string, text: string, version?: number) => Effect.Effect<void>;
	readonly change: (path: string, text: string, version?: number) => Effect.Effect<void>;
	readonly close: (path: string) => Effect.Effect<void>;
	readonly watchedFilesChanged: (paths: ReadonlyArray<string>) => Effect.Effect<WatchedFilesOutcome>;
	readonly revalidate: (options: RevalidateOptions) => Effect.Effect<RevalidateResult, RevalidateError>;
	readonly bundle: () => Effect.Effect<Option.Option<LoadedBundle>>;
	readonly graph: () => Effect.Effect<Option.Option<LinkGraph>>;
	readonly config: () => OkfitConfig;
}

interface Loaded {
	readonly bundle: LoadedBundle;
	readonly graph: LinkGraph;
}

const CONFIG_BASENAMES: ReadonlySet<string> = new Set(
	PROJECT_CONFIG_NAMES.map((name) => name.slice(name.lastIndexOf("/") + 1)),
);

/**
 * One bundle root's editor state (spec 4): open-document overlay, last loaded
 * bundle and graph, and last published diagnostics per file. Debounce is NOT
 * here: the caller (the LSP server) schedules revalidates; overlapping calls are
 * serialized so every change is reported exactly once.
 *
 * @public
 */
export class BundleSession extends Context.Service<BundleSession, BundleSessionShape>()("@okfit/engine/BundleSession") {
	/** Build a session; the returned operations need no services. */
	static readonly make = (
		options: BundleSessionOptions,
	): Effect.Effect<BundleSessionShape, never, BundleSessionServices> =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const underlying = yield* FileSystem.FileSystem;
			const context = yield* Effect.context<BundleSessionServices>();
			const root = path.resolve(options.root);
			const overlay = OverlayDocuments.make();
			const fileSystem = makeOverlayFileSystem(underlying, overlay);
			const semaphore = yield* Semaphore.make(1);
			const published = yield* Ref.make<DiagnosticsByFile>(new Map());
			const loaded = yield* Ref.make<Option.Option<Loaded>>(Option.none());

			const revalidateNow = Effect.fn("BundleSession.revalidate")(function* (revalidate: RevalidateOptions) {
				const result = yield* run({
					root,
					config: options.config,
					profile: options.profile,
					now: revalidate.now,
					skipProvenance: revalidate.tier === "edit",
				}).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem), Effect.provideContext(context));
				const rendered = sort(
					collect(result.report.conformance, result.report.lint, result.profileDiagnostics).map((diagnostic) =>
						withFallbackRange(result.bundle, diagnostic),
					),
				);
				const next = groupByFile(rendered);
				// One atomic read-diff-write: exactly-once reporting holds by construction.
				// The semaphore (below) is what keeps an older, slower run from landing last.
				const changed = yield* Ref.modify(published, (previous) => [diffDiagnostics(previous, next), next] as const);
				yield* Ref.set(loaded, Option.some({ bundle: result.bundle, graph: Graph.fromBundle(result.bundle) }));
				return { changed, bundle: result.bundle };
			});

			return BundleSession.of({
				root,
				open: (file, text, version) => overlay.open(path.resolve(file), text, version),
				change: (file, text, version) => overlay.change(path.resolve(file), text, version),
				close: (file) => overlay.close(path.resolve(file)),
				watchedFilesChanged: (paths) =>
					Effect.succeed({ configChanged: paths.some((file) => CONFIG_BASENAMES.has(path.basename(file))) }),
				revalidate: (revalidate) => semaphore.withPermit(revalidateNow(revalidate)),
				bundle: () =>
					Effect.map(
						Ref.get(loaded),
						Option.map((state) => state.bundle),
					),
				graph: () =>
					Effect.map(
						Ref.get(loaded),
						Option.map((state) => state.graph),
					),
				config: () => options.config,
			});
		});
}
