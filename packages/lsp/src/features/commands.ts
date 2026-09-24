/**
 * `registerCommands`: `workspace/executeCommand` for the three okfit commands
 * `features/names.ts`'s `OKFIT_COMMANDS` advertises -- `okfit.lsp.setStatus`,
 * `okfit.lsp.markVerified`, `okfit.lsp.revalidate`.
 *
 * `okfit.lsp.setStatus` and `okfit.lsp.markVerified` compute a `TextEdit` with
 * `features/edits.ts` against the concept's current text (the open buffer,
 * else the file as last loaded) and send it, versioned with that buffer's
 * version (`versionedEdit`), to the client with
 * `transport.sendRequest<ApplyWorkspaceEditParams,
 * ApplyWorkspaceEditResult>("workspace/applyEdit", ...)`, and answer with the
 * client's own result verbatim -- a transport failure of that request already
 * fails as an `LspError` (`LspTransportShape.sendRequest`'s own contract).
 * `okfit.lsp.revalidate` schedules a `full` revalidate (`handle.scheduler.schedule("full")`
 * then `.settle`, the same warm-up path `features/concepts.ts` uses) on one
 * named bundle root or, with no argument, every live session, and answers
 * with the root URIs it revalidated.
 *
 * Every command's arguments are decoded through a small `Schema.Tuple`; a
 * decode failure fails as an `LspError` naming the expected shape. An
 * `EditFailure` from `edits.ts` fails as an `LspError` whose message is
 * `describeFailure(...)`; an unrecognized command id fails as an `LspError`
 * naming it.
 *
 * @packageDocumentation
 */
import type { Git } from "@effected/git";
import { Status } from "@okfit/core";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { pathToUri, uriToPath } from "../convert/uri.js";
import { LspError } from "../errors.js";
import type { LspTransportShape } from "../protocol/LspTransport.js";
import type {
	ApplyWorkspaceEditParams,
	ApplyWorkspaceEditResult,
	ExecuteCommandParams,
	TextEdit,
} from "../protocol/types.js";
import type { OpenDocuments } from "../session/documents.js";
import type { SessionRegistryShape } from "../session/registry.js";
import type { EditFailure, EditTarget } from "./edits.js";
import {
	describeFailure,
	editTarget,
	resolveActor,
	statusTextEdits,
	verifiedTextEdits,
	versionedEdit,
} from "./edits.js";

/** `[uri, status]` for `okfit.lsp.setStatus`. */
const SetStatusArgs = Schema.Tuple([Schema.String, Status]);
/** `[uri]` for `okfit.lsp.markVerified`. */
const MarkVerifiedArgs = Schema.Tuple([Schema.String]);
/** `[rootUri?]` for `okfit.lsp.revalidate`: the array may be empty. */
const RevalidateArgs = Schema.Tuple([Schema.optionalKey(Schema.String)]);

/** `params.arguments` (`undefined` when the client sent none) decoded through `schema`, or `LspError` naming `expected`. */
const decodeArgs = <S extends Schema.ConstraintDecoder<unknown>>(
	schema: S,
	args: ReadonlyArray<unknown> | undefined,
	expected: string,
): Effect.Effect<S["Type"], LspError> => {
	const result = Schema.decodeUnknownResult(schema)(args ?? []);
	return Result.isFailure(result)
		? Effect.fail(new LspError({ code: -32602, message: expected }))
		: Effect.succeed(result.success);
};

/** `failure` as an `LspError`, `describeFailure`'s message under the "request failed" JSON-RPC code. */
const toLspError = (failure: EditFailure): LspError =>
	new LspError({ code: -32803, message: describeFailure(failure) });

/** `LspError` for a `uri` that is not a `file:` URI: mirrors `describeFailure`'s `NotAConcept` wording. */
const notAConcept: LspError = toLspError({ _tag: "NotAConcept" });

/**
 * Send `edits` to the client as a single-file, versioned `workspace/applyEdit`
 * under `label`, and answer its result verbatim -- the round trip
 * `okfit.lsp.setStatus` and `okfit.lsp.markVerified` both make, differing
 * only in which edits they compute and what they label the edit.
 */
const applyConceptEdit = (
	transport: LspTransportShape,
	uri: string,
	target: EditTarget,
	label: string,
	edits: ReadonlyArray<TextEdit>,
): Effect.Effect<ApplyWorkspaceEditResult, LspError> =>
	transport.sendRequest<ApplyWorkspaceEditParams, ApplyWorkspaceEditResult>("workspace/applyEdit", {
		label,
		edit: versionedEdit(uri, target, edits),
	});

/** The concept at `uri` as the editor currently holds it, or `notAConcept`. */
const targetFor = (
	registry: SessionRegistryShape,
	documents: OpenDocuments,
	uri: string,
): Effect.Effect<EditTarget, LspError> =>
	Effect.gen(function* () {
		const path = uriToPath(uri);
		if (Option.isNone(path)) return yield* Effect.fail(notAConcept);
		const target = yield* editTarget(registry, documents, path.value);
		if (Option.isNone(target)) return yield* Effect.fail(notAConcept);
		return target.value;
	});

const handleSetStatus = (
	registry: SessionRegistryShape,
	documents: OpenDocuments,
	transport: LspTransportShape,
	args: ReadonlyArray<unknown> | undefined,
): Effect.Effect<ApplyWorkspaceEditResult, LspError> =>
	Effect.gen(function* () {
		const [uri, status] = yield* decodeArgs(SetStatusArgs, args, "okfit.lsp.setStatus expects [uri, status]");
		const target = yield* targetFor(registry, documents, uri);
		const edits = yield* statusTextEdits(target, status).pipe(Effect.mapError(toLspError));
		return yield* applyConceptEdit(transport, uri, target, `Set status: ${status}`, edits);
	});

const handleMarkVerified = (
	registry: SessionRegistryShape,
	documents: OpenDocuments,
	transport: LspTransportShape,
	args: ReadonlyArray<unknown> | undefined,
): Effect.Effect<ApplyWorkspaceEditResult, LspError, Git> =>
	Effect.gen(function* () {
		const [uri] = yield* decodeArgs(MarkVerifiedArgs, args, "okfit.lsp.markVerified expects [uri]");
		const target = yield* targetFor(registry, documents, uri);
		if (target.status === "draft") return yield* Effect.fail(toLspError({ _tag: "DraftCannotBeVerified" }));
		const actor = yield* resolveActor(target.handle).pipe(Effect.mapError(toLspError));
		const now = yield* DateTime.now;
		const edits = yield* verifiedTextEdits(target, actor, now).pipe(Effect.mapError(toLspError));
		return yield* applyConceptEdit(transport, uri, target, "Mark verified", edits);
	});

/** Result of `okfit.lsp.revalidate`. @public */
export interface RevalidateResult {
	/** The root URIs of every session `okfit.lsp.revalidate` scheduled a `full` revalidate for. */
	readonly roots: ReadonlyArray<string>;
}

const handleRevalidate = (
	registry: SessionRegistryShape,
	args: ReadonlyArray<unknown> | undefined,
): Effect.Effect<RevalidateResult, LspError> =>
	Effect.gen(function* () {
		const [rootUri] = yield* decodeArgs(RevalidateArgs, args, "okfit.lsp.revalidate expects [rootUri?]");
		const handles = yield* registry.sessions;
		const rootPath = rootUri === undefined ? Option.none<string>() : uriToPath(rootUri);
		const targets =
			rootUri === undefined ? handles : handles.filter((handle) => Option.contains(rootPath, handle.bundleRoot));
		yield* Effect.forEach(
			targets,
			(handle) => Effect.andThen(handle.scheduler.schedule("full"), handle.scheduler.settle),
			{ discard: true, concurrency: "unbounded" },
		);
		return { roots: targets.map((handle) => pathToUri(handle.bundleRoot)) };
	});

/** `LspError` naming an unrecognized command id. */
const unknownCommand = (command: string): LspError =>
	new LspError({ code: -32601, message: `Unknown command ${command}` });

const dispatch = (
	registry: SessionRegistryShape,
	documents: OpenDocuments,
	transport: LspTransportShape,
	params: ExecuteCommandParams,
): Effect.Effect<unknown, LspError, Git> => {
	switch (params.command) {
		case "okfit.lsp.setStatus":
			return handleSetStatus(registry, documents, transport, params.arguments);
		case "okfit.lsp.markVerified":
			return handleMarkVerified(registry, documents, transport, params.arguments);
		case "okfit.lsp.revalidate":
			return handleRevalidate(registry, params.arguments);
		default:
			return Effect.fail(unknownCommand(params.command));
	}
};

/**
 * Wires `workspace/executeCommand` onto `transport` for the three okfit
 * commands, computing edits against `documents`' open buffers. See the file
 * header for each command's argument shape, result and failure mapping.
 *
 * @public
 */
export const registerCommands = (
	transport: LspTransportShape,
	registry: SessionRegistryShape,
	documents: OpenDocuments,
): Effect.Effect<void, never, Git> =>
	Effect.gen(function* () {
		const context = yield* Effect.context<Git>();
		yield* transport.onRequest<ExecuteCommandParams, unknown>("workspace/executeCommand", (params) =>
			dispatch(registry, documents, transport, params).pipe(Effect.provideContext(context)),
		);
	});
