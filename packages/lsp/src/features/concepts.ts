/**
 * `registerConcepts`: the `okfit/concepts` request, answering from every live
 * session's last-loaded bundle with what an editor's concept explorer needs
 * (type, status, staleness, definition URI), and the `okfit/bundleChanged`
 * notification the server sends after a revalidate or a dropped session.
 *
 * `okfit/concepts` warms up: it builds a session for every workspace folder
 * that has never been resolved and runs a first `full` revalidate for any
 * bundle root that has never loaded, so a client that asks before opening a
 * document still gets its concepts. Nothing warms up on its own -- a server
 * with no workspace folders open and no client ever sending this request
 * builds no session, exactly as before, so Claude Code's lazy-by-default
 * startup is unaffected.
 *
 * Both are okfit extensions to the protocol: method names carry the
 * `okfit/` prefix, as the LSP specification reserves `$/` for its own
 * extensions and leaves vendor prefixes to implementations.
 *
 * @packageDocumentation
 */
import type { LoadedBundle, Status } from "@okfit/core";
import { Derive } from "@okfit/core";
import { DateTime, Effect, Option } from "effect";
import { pathToUri } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { SessionHandle, SessionRegistryShape } from "../session/registry.js";
import { definitionOf } from "./locate.js";

/** One concept as the explorer needs it. @public */
export interface ConceptSummary {
	readonly id: string;
	readonly uri: string;
	readonly title: string;
	readonly type: string;
	readonly status: Status | undefined;
	readonly stale: boolean;
}

/** One bundle root's concepts. @public */
export interface BundleSummary {
	readonly root: string;
	readonly rootUri: string;
	readonly profile: string | undefined;
	readonly concepts: ReadonlyArray<ConceptSummary>;
}

/** Result of `okfit/concepts`. @public */
export interface ConceptsResult {
	readonly bundles: ReadonlyArray<BundleSummary>;
}

/** Params of `okfit/bundleChanged`. @public */
export interface BundleChangedParams {
	readonly rootUri: string;
	readonly reason: "revalidated" | "dropped";
}

/** The request method name. @public */
export const CONCEPTS_REQUEST = "okfit/concepts";
/** The notification method name. @public */
export const BUNDLE_CHANGED_NOTIFICATION = "okfit/bundleChanged";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const summarise = (bundle: LoadedBundle, now: DateTime.Utc): ReadonlyArray<ConceptSummary> => {
	const out: Array<ConceptSummary> = [];
	for (const [id, concept] of bundle.concepts) {
		const location = definitionOf(bundle, id);
		if (Option.isNone(location)) continue;
		out.push({
			id,
			uri: location.value.uri,
			title: Derive.title(concept),
			type: concept.frontmatter.type,
			status: concept.frontmatter.status,
			stale: Derive.isStale(concept.frontmatter, now),
		});
	}
	return out.sort((a, b) => compare(a.type, b.type) || compare(a.title, b.title) || compare(a.id, b.id));
};

/** `config.bundle.profile`, mapping the documented `"none"` sentinel (profile merging disabled) to `undefined`. */
const profileOf = (handle: SessionHandle): string | undefined => {
	const profile = handle.session.config().bundle?.profile;
	return profile === "none" ? undefined : profile;
};

const bundleSummary = (handle: SessionHandle, now: DateTime.Utc): Effect.Effect<Option.Option<BundleSummary>> =>
	Effect.map(handle.session.bundle(), (bundle) =>
		Option.map(bundle, (loaded) => ({
			root: handle.bundleRoot,
			rootUri: pathToUri(handle.bundleRoot),
			profile: profileOf(handle),
			concepts: summarise(loaded, now),
		})),
	);

/**
 * Wires `okfit/concepts` onto `transport`. First a warm-up: for every
 * current workspace folder (`registry.folders`), `registry.sessionFor`
 * builds its session if it has never been resolved (no `retryFailed` -- a
 * folder whose config already failed to load stays failed). `sessionFor`
 * answers `None` for a folder whose resolved bundle root does not itself
 * contain the folder path (a workspace folder one level above its `okf/`
 * bundle root, say) even once the session is built, so the handles to warm
 * are read back from `registry.sessions` -- already deduped one per bundle
 * root -- rather than collected from `sessionFor`'s own return values. For
 * each handle whose `session.bundle()` is still `None`,
 * `handle.scheduler.schedule("full")` then `handle.scheduler.settle` runs a
 * first revalidate through the normal scheduler path, so diagnostics publish
 * and `okfit/bundleChanged` fires exactly as a real edit would trigger them.
 * Only then does it answer, exactly as before, from every live session's
 * last-loaded bundle; a session whose bundle still never loaded (no config,
 * or one that failed) contributes no entry. Concepts within a bundle are
 * sorted by type, then title, then id; bundles are sorted by root.
 *
 * @public
 */
export const registerConcepts = (transport: LspTransportShape, registry: SessionRegistryShape): Effect.Effect<void> =>
	transport.onRequest<Record<string, never>, ConceptsResult>(CONCEPTS_REQUEST, () =>
		Effect.gen(function* () {
			const now = yield* DateTime.now;
			const folders = yield* registry.folders;
			yield* Effect.forEach(folders, (folder) => registry.sessionFor(folder), { discard: true });
			const handles = yield* registry.sessions;
			yield* Effect.forEach(
				handles,
				(handle) =>
					Effect.gen(function* () {
						const bundle = yield* handle.session.bundle();
						if (Option.isSome(bundle)) return;
						yield* handle.scheduler.schedule("full");
						yield* handle.scheduler.settle;
					}),
				{ discard: true },
			);
			const summaries = yield* Effect.forEach(handles, (handle) => bundleSummary(handle, now));
			// One session per root in the registry, so no dedupe is needed here.
			return {
				bundles: summaries.flatMap((s) => Option.toArray(s)).sort((a, b) => compare(a.root, b.root)),
			};
		}),
	);

/**
 * Sends `okfit/bundleChanged` for `root`: the server calls this from the
 * registry's `onRevalidate` and `onDispose` callbacks, after `publish`/`clear`
 * respectively, so a client's re-fetch of `okfit/concepts` sees the
 * already-published diagnostics.
 *
 * @public
 */
export const notifyBundleChanged = (
	transport: LspTransportShape,
	root: string,
	reason: BundleChangedParams["reason"],
): Effect.Effect<void> =>
	transport.sendNotification<BundleChangedParams>(BUNDLE_CHANGED_NOTIFICATION, { rootUri: pathToUri(root), reason });
