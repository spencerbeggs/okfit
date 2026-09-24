/**
 * `registerCodeActions`: `textDocument/codeAction` over the concept's
 * current text (`edits.ts`'s {@link EditTarget}: the open buffer, else the
 * file as last loaded), resolved once per request and never a trigger or a
 * wait.
 *
 * Three groups of actions, each computed by `features/edits.ts` and sent as a
 * versioned `WorkspaceEdit` (`versionedEdit`):
 *
 * - **Quick fixes.** When `context.diagnostics` carries a `status-missing`
 *   diagnostic (`code === "status-missing"` and, when it carries `data`,
 *   `data.source === "core.lint"` -- `convert/diagnostic.ts`'s own shape):
 *   `Set status: draft` (`isPreferred`) and `Set status: stable`, kind
 *   `quickfix`, each carrying that diagnostic. Offered wherever the request
 *   range sits, since the client only sends the diagnostic when it overlaps.
 * - **Status actions** (kind `okfit.status`). `Set status: <status>` for each
 *   status the raw frontmatter `status` is not already (all three when it has
 *   no explicit status), in `Status`'s literal order, minus any a quick fix
 *   already offers.
 * - **Verify action** (kind `okfit.verify`). `Mark verified by <actor>` when
 *   a human actor resolves and the concept is neither a draft nor already
 *   verified by that actor.
 *
 * The status and verify actions are offered only when the request range
 * intersects the frontmatter block, or `context.only` names their kind; the
 * quick fixes only when `context.only` is absent or names `quickfix`. The
 * resolved actor is cached per session handle (a rebuilt session is a fresh
 * handle, so it gets a fresh lookup); a failed resolution is not cached, and
 * is logged at `logDebug` once per session handle.
 *
 * @packageDocumentation
 */
import type { Git } from "@effected/git";
import { Status } from "@okfit/core";
import { DateTime, Effect, Option, Result } from "effect";
import { uriToPath } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { CodeAction, CodeActionParams, Position, Range } from "../protocol/types.js";
import { CODE_ACTION_KIND_QUICKFIX } from "../protocol/types.js";
import type { OpenDocuments } from "../session/documents.js";
import type { SessionHandle, SessionRegistryShape } from "../session/registry.js";
import type { EditTarget } from "./edits.js";
import {
	describeFailure,
	editTarget,
	resolveActor,
	statusTextEdits,
	verifiedTextEdits,
	versionedEdit,
} from "./edits.js";

/** `Status`'s own literal order: `draft`, `stable`, `deprecated` (D-28's `Schema.Literals` declaration order). */
const STATUSES: ReadonlyArray<Status> = Status.literals;

/** The statuses a `status-missing` quick fix offers, the first preferred. */
const QUICK_FIX_STATUSES: ReadonlyArray<Status> = ["draft", "stable"];

/** `diagnostics`' own `status-missing` entry, `convert/diagnostic.ts`'s exact shape (`code`, `data.source`). */
const statusMissingOf = (
	diagnostics: CodeActionParams["context"]["diagnostics"],
): CodeActionParams["context"]["diagnostics"][number] | undefined =>
	diagnostics.find(
		(diagnostic) =>
			diagnostic.code === "status-missing" &&
			(diagnostic.data === undefined || (diagnostic.data as { readonly source?: unknown }).source === "core.lint"),
	);

/** Whether `kind` is one of `only`'s kinds or nested under one (LSP code action kinds are dot-hierarchical). */
const named = (only: ReadonlyArray<string>, kind: string): boolean =>
	only.some((requested) => kind === requested || kind.startsWith(`${requested}.`));

/** `a` before `b` in document order. */
const before = (a: Position, b: Position): boolean =>
	a.line < b.line || (a.line === b.line && a.character < b.character);

/** Whether `request` touches `block` (half-open at `block.end`, the start of the first body line). */
const intersects = (request: Range, block: Range): boolean =>
	before(request.start, block.end) && !before(request.end, block.start);

/**
 * Wires `textDocument/codeAction` onto `transport`, answering from the
 * concept's current text (`documents`' open buffer, else `registry`'s
 * last-loaded snapshot). A missing session, an unloaded bundle, a non-`file:`
 * URI, a path outside every bundle root, or unparseable frontmatter all
 * answer `[]` -- never a hang. See the file header for the action set.
 *
 * @public
 */
export const registerCodeActions = (
	transport: LspTransportShape,
	registry: SessionRegistryShape,
	documents: OpenDocuments,
): Effect.Effect<void, never, Git> =>
	Effect.gen(function* () {
		const context = yield* Effect.context<Git>();
		// Keyed by handle identity: a rebuilt session is a new handle, so its actor is looked up afresh,
		// and a disposed handle's entry is collected with it.
		const actors = new WeakMap<SessionHandle, string>();
		const loggedFailures = new WeakSet<SessionHandle>();

		const actorFor = (handle: SessionHandle): Effect.Effect<Option.Option<string>, never, Git> =>
			Effect.gen(function* () {
				const cached = actors.get(handle);
				if (cached !== undefined) return Option.some(cached);
				// `Effect.result` converts only the typed `ActorUnresolved` channel; a defect or an interrupt
				// still propagates rather than being read as "no actor".
				const resolved = yield* Effect.result(resolveActor(handle));
				if (Result.isSuccess(resolved)) {
					actors.set(handle, resolved.success);
					return Option.some(resolved.success);
				}
				if (!loggedFailures.has(handle)) {
					loggedFailures.add(handle);
					yield* Effect.logDebug(
						`okfit-lsp: could not resolve a human actor for ${handle.folder}: ${describeFailure(resolved.failure)}`,
					);
				}
				return Option.none<string>();
			});

		const statusAction = (uri: string, target: EditTarget, status: Status): Effect.Effect<Option.Option<CodeAction>> =>
			Effect.map(Effect.option(statusTextEdits(target, status)), (edits) =>
				Option.map(edits, (value) => ({
					title: `Set status: ${status}`,
					kind: "okfit.status",
					edit: versionedEdit(uri, target, value),
				})),
			);

		yield* transport.onRequest<CodeActionParams, ReadonlyArray<CodeAction>>("textDocument/codeAction", (params) =>
			Effect.gen(function* () {
				const uri = params.textDocument.uri;
				const path = uriToPath(uri);
				if (Option.isNone(path)) return [];
				const found = yield* editTarget(registry, documents, path.value);
				if (Option.isNone(found)) return [];
				const target = found.value;
				const only = params.context.only;
				const inFrontmatter = intersects(params.range, target.frontmatter);
				const offer = (kind: string): boolean => (only === undefined ? inFrontmatter : named(only, kind));

				const actions: Array<CodeAction> = [];
				const statusMissing = statusMissingOf(params.context.diagnostics);
				const quickFixes =
					statusMissing !== undefined && (only === undefined || named(only, CODE_ACTION_KIND_QUICKFIX))
						? QUICK_FIX_STATUSES
						: [];
				for (const status of quickFixes) {
					const action = yield* statusAction(uri, target, status);
					if (Option.isNone(action)) continue;
					actions.push({
						...action.value,
						kind: CODE_ACTION_KIND_QUICKFIX,
						diagnostics: [statusMissing as NonNullable<typeof statusMissing>],
						isPreferred: status === "draft",
					});
				}

				if (offer("okfit.status")) {
					for (const status of STATUSES) {
						if (status === target.status || quickFixes.includes(status)) continue;
						const action = yield* statusAction(uri, target, status);
						if (Option.isSome(action)) actions.push(action.value);
					}
				}

				if (offer("okfit.verify") && target.status !== "draft") {
					const actor = yield* actorFor(target.handle);
					if (Option.isSome(actor)) {
						const now = yield* DateTime.now;
						const edits = yield* Effect.option(verifiedTextEdits(target, actor.value, now));
						if (Option.isSome(edits)) {
							actions.push({
								title: `Mark verified by ${actor.value}`,
								kind: "okfit.verify",
								edit: versionedEdit(uri, target, edits.value),
							});
						}
					}
				}

				return actions;
			}).pipe(Effect.provideContext(context)),
		);
	});
