/**
 * `registerCodeActions`: `textDocument/codeAction` over the session's
 * last-loaded snapshot (decision 4 of the phase 4 plan, carried into LSP
 * roadmap phase 5 -- answered from whatever `edits.ts`'s helpers can compute
 * against it, never a trigger or a wait).
 *
 * Every action's edit is computed by `features/edits.ts`: a `Set status:
 * <status>` action (kind `okfit.status`) per status the concept is not
 * already in, in `Status`'s own literal order (`draft`, `stable`,
 * `deprecated`), and one `Mark verified by <actor>` action (kind
 * `okfit.verify`) when a human actor resolves and the concept is not a
 * draft and not already verified by that actor. When `context.diagnostics`
 * carries a `status-missing` diagnostic (`code === "status-missing"` and,
 * when the diagnostic carries `data`, `data.source === "core.lint"` --
 * `convert/diagnostic.ts`'s own shape), every status action is promoted to
 * kind `quickfix`, carries that diagnostic in its own `diagnostics`, and the
 * `draft` action alone is `isPreferred`.
 *
 * @packageDocumentation
 */
import type { Git } from "@effected/git";
import { Derive, Status } from "@okfit/core";
import { DateTime, Effect, Option } from "effect";
import { uriToPath } from "../convert/uri.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type { CodeAction, CodeActionParams } from "../protocol/types.js";
import { CODE_ACTION_KIND_QUICKFIX } from "../protocol/types.js";
import type { SessionRegistryShape } from "../session/registry.js";
import { conceptSnapshot, humanActor, statusTextEdits, verifiedTextEdits } from "./edits.js";

/** `Status`'s own literal order: `draft`, `stable`, `deprecated` (D-28's `Schema.Literals` declaration order). */
const STATUSES: ReadonlyArray<Status> = Status.literals;

/** `diagnostics`' own `status-missing` entry, `convert/diagnostic.ts`'s exact shape (`code`, `data.source`). */
const statusMissingOf = (
	diagnostics: CodeActionParams["context"]["diagnostics"],
): CodeActionParams["context"]["diagnostics"][number] | undefined =>
	diagnostics.find(
		(diagnostic) =>
			diagnostic.code === "status-missing" &&
			(diagnostic.data === undefined || (diagnostic.data as { readonly source?: unknown }).source === "core.lint"),
	);

/**
 * Wires `textDocument/codeAction` onto `transport`, answering from
 * `registry`'s last-loaded snapshot. A missing session, an unloaded bundle,
 * a non-`file:` URI, or a path outside every bundle root all answer `[]` --
 * never a hang. See the file header for the action set.
 *
 * @public
 */
export const registerCodeActions = (
	transport: LspTransportShape,
	registry: SessionRegistryShape,
): Effect.Effect<void, never, Git> =>
	Effect.gen(function* () {
		const context = yield* Effect.context<Git>();
		yield* transport.onRequest<CodeActionParams, ReadonlyArray<CodeAction>>("textDocument/codeAction", (params) =>
			Effect.gen(function* () {
				const path = uriToPath(params.textDocument.uri);
				if (Option.isNone(path)) return [];
				const snapshot = yield* conceptSnapshot(registry, path.value);
				if (Option.isNone(snapshot)) return [];
				const current = Derive.status(snapshot.value.concept.frontmatter);
				const statusMissing = statusMissingOf(params.context.diagnostics);

				const actions: Array<CodeAction> = [];
				for (const status of STATUSES) {
					if (status === current) continue;
					const edits = yield* Effect.option(statusTextEdits(registry, path.value, status));
					if (Option.isNone(edits)) continue;
					const edit = { changes: { [params.textDocument.uri]: [...edits.value] } };
					actions.push(
						statusMissing === undefined
							? { title: `Set status: ${status}`, kind: "okfit.status", edit }
							: {
									title: `Set status: ${status}`,
									kind: CODE_ACTION_KIND_QUICKFIX,
									diagnostics: [statusMissing],
									isPreferred: status === "draft",
									edit,
								},
					);
				}

				const actor = yield* humanActor(registry, path.value);
				if (Option.isSome(actor)) {
					const now = yield* DateTime.now;
					const edits = yield* Effect.option(verifiedTextEdits(registry, path.value, now));
					if (Option.isSome(edits)) {
						actions.push({
							title: `Mark verified by ${actor.value}`,
							kind: "okfit.verify",
							edit: { changes: { [params.textDocument.uri]: [...edits.value] } },
						});
					}
				}

				return actions;
			}).pipe(Effect.provideContext(context)),
		);
	});
