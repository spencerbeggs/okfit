import type { Status } from "./tree/model.js";

/** One entry in the `okfit.setStatus` quick pick. */
export interface StatusPick {
	readonly label: Status;
	readonly description: string;
}

/** `Status`'s own literal order (matches `@okfit/lsp`'s `registerCodeActions` action ordering). */
const ORDER: ReadonlyArray<Status> = ["draft", "stable", "deprecated"];

const DESCRIPTIONS: Readonly<Record<Status, string>> = {
	draft: "Not yet reviewed",
	stable: "Reviewed and current",
	deprecated: "No longer recommended",
};

/**
 * The statuses `current` is not already in, in `Status`'s own literal order
 * -- all three when `current` is `undefined` (no explicit `status` key), so
 * an implicit `stable` can be made explicit, matching the server's own
 * status code actions.
 */
export const statusPicks = (current: Status | undefined): ReadonlyArray<StatusPick> =>
	ORDER.filter((status) => status !== current).map((status) => ({
		label: status,
		description: DESCRIPTIONS[status],
	}));

/** The shape of a `TreeNode` concept node's argument to `okfit.setStatus`/`okfit.markVerified`, without importing `tree/model.js`'s full union. */
interface ConceptNodeArg {
	readonly kind: "concept";
	readonly uri: string;
}

const isConceptNode = (arg: unknown): arg is ConceptNodeArg =>
	typeof arg === "object" &&
	arg !== null &&
	(arg as Record<string, unknown>).kind === "concept" &&
	typeof (arg as Record<string, unknown>).uri === "string";

/**
 * The concept URI `okfit.setStatus`/`okfit.markVerified` should act on: a
 * tree-node argument's own `uri` when the command was invoked from the OKF
 * Concepts view, else `activeUri` (the active editor's document URI) when
 * the command was invoked with no argument (Command Palette), else
 * `undefined` when neither is available.
 */
export const conceptUriFrom = (arg: unknown, activeUri: string | undefined): string | undefined =>
	isConceptNode(arg) ? arg.uri : activeUri;
