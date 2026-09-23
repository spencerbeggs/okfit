/**
 * The wire types and method names for `okfit/concepts` and
 * `okfit/bundleChanged`, copied verbatim from `packages/lsp/src/features/concepts.ts`
 * (Task 2) rather than importing `@okfit/lsp` into the extension bundle --
 * the extension host entry point never imports the LSP package directly, only
 * `vscode-languageclient`.
 */

/** One concept as the explorer needs it. */
export interface ConceptSummary {
	readonly id: string;
	readonly uri: string;
	readonly title: string;
	readonly type: string;
	readonly status: "draft" | "stable" | "deprecated" | undefined;
	readonly stale: boolean;
}

/** One bundle root's concepts. */
export interface BundleSummary {
	readonly root: string;
	readonly rootUri: string;
	readonly profile: string | undefined;
	readonly concepts: ReadonlyArray<ConceptSummary>;
}

/** Result of `okfit/concepts`. */
export interface ConceptsResult {
	readonly bundles: ReadonlyArray<BundleSummary>;
}

/** Params of `okfit/bundleChanged`. */
export interface BundleChangedParams {
	readonly rootUri: string;
	readonly reason: "revalidated" | "dropped";
}

/** The request method name. */
export const CONCEPTS_REQUEST = "okfit/concepts";
/** The notification method name. */
export const BUNDLE_CHANGED_NOTIFICATION = "okfit/bundleChanged";

/**
 * Command ids the server advertises in `executeCommandProvider.commands`,
 * copied verbatim from `packages/lsp/src/features/names.ts`'s
 * `OKFIT_COMMANDS` (Task 6) -- same rationale as this file's own header: the
 * extension never imports `@okfit/lsp`.
 */
export const OKFIT_COMMANDS = ["okfit.setStatus", "okfit.markVerified", "okfit.revalidate"] as const;
