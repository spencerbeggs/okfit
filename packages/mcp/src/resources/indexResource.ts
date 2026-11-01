import type { AppDirs, Xdg } from "@effected/xdg";
import type { Context } from "effect";
import { Effect, FileSystem, Layer, Path } from "effect";
import { McpSchema, McpServer } from "effect/ai";
import { loadToolContext } from "../internal/toolContext.js";

/**
 * `okf://index` — the bundle's root `index.md`, read from disk.
 *
 * This reads the file from disk, deliberately (J-7): `IndexDocument`
 * carries only `{ path, dir, okfVersion?, sections }` — no raw-source
 * field at all — so `bundle.indexes.get("")` cannot supply the raw
 * markdown N-19 asks for. Reading the file also means a root `index.md`
 * that failed to parse is still served, which is the more useful
 * behaviour for an agent trying to fix it.
 *
 * A missing `index.md` fails the read rather than returning placeholder
 * text (J-8): a resource that silently returns prose instead of the file
 * it names is indistinguishable, to a model, from a bundle whose index
 * really says that; §6.1 already fails an unknown id through the same
 * channel.
 *
 * `content` builds the full `ReadResourceResult` itself, `mimeType`
 * included, rather than returning a bare string: verified against source
 * (`resolveResourceContent`, `ai/McpServer.ts:2556-2576`), a bare
 * string is wrapped as `{ contents: [{ uri, text }] }` with no `mimeType`
 * at all — the declared `mimeType` option only documents the resource in
 * `resources/list`, it is never merged into a `resources/read` response.
 *
 * The platform services `content` reads are captured once when the layer
 * builds and provided to every read: since Effect 4.1 a resource handler's
 * services are request-level `McpRequest<"Requires", S>` requirements, and
 * these are fixed for the server's lifetime.
 *
 * @public
 */
export const IndexResource = (
	projectRoot: string,
): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg | McpServer.McpServer> =>
	Layer.unwrap(
		Effect.map(Effect.context<FileSystem.FileSystem | Path.Path | AppDirs | Xdg>(), (services) =>
			indexResource(projectRoot, services),
		),
	);

const indexResource = (
	projectRoot: string,
	services: Context.Context<FileSystem.FileSystem | Path.Path | AppDirs | Xdg>,
) =>
	McpServer.resource({
		uri: "okf://index",
		name: "OKF bundle index",
		description: "The bundle's root index.md — the entry point for orienting on this OKF bundle.",
		mimeType: "text/markdown",
		content: Effect.gen(function* () {
			const ctx = yield* loadToolContext(projectRoot);
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const indexPath = path.join(ctx.bundleRoot, "index.md");
			const text = yield* fs
				.readFileString(indexPath)
				.pipe(Effect.mapError(() => new McpSchema.InternalError({ message: `no readable index.md at ${indexPath}` })));
			return { contents: [{ uri: "okf://index", mimeType: "text/markdown", text }] };
		}).pipe(Effect.provide(services)),
	});
