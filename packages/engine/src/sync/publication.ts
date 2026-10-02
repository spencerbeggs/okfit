import { MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { BundleLoadError } from "@okfit/core";
import { Bundle, ConceptId } from "@okfit/core";
import { Derivation, PUBLICATION_TYPE, Publications } from "@okfit/profiles";
import type { Crypto, FileSystem, PlatformError } from "effect";
import { Effect, Option, Path, Runtime, Schema } from "effect";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "../edits/FrontmatterEdits.js";
import { writeAtomic } from "./write.js";

/**
 * No concept answers to `id` -- or one of a Publication's `renders` paths
 * resolves to no concept, in which case `id` names that missing source.
 *
 * @public
 */
export class PublicationNotFoundError extends Schema.TaggedError<PublicationNotFoundError>()(
	"PublicationNotFoundError",
	{ id: Schema.String },
) {
	override readonly [Runtime.errorExitCode] = 2;
	override get message(): string {
		return `no concept "${this.id}" in the bundle`;
	}
}

/**
 * The concept at `id` exists but is not a Publication (`type` is what it is).
 *
 * @public
 */
export class NotAPublicationError extends Schema.TaggedError<NotAPublicationError>()("NotAPublicationError", {
	id: Schema.String,
	type: Schema.String,
}) {
	override readonly [Runtime.errorExitCode] = 2;
	override get message(): string {
		return `"${this.id}" is a ${this.type}, not a ${PUBLICATION_TYPE}`;
	}
}

/**
 * Restamps one Publication's `renders[].body_sha256` digests from the current
 * body of each rendered source concept, writing the Publication file
 * atomically unless `dryRun`. `written` is whether the text changed (so a
 * `dryRun` that would change the file reports `true` without writing).
 * A malformed `renders` fails `UnsupportedFrontmatterError`.
 *
 * @public
 */
export const stampPublication = (options: {
	readonly bundleRoot: string;
	readonly id: string;
	readonly dryRun: boolean;
}): Effect.Effect<
	{
		readonly id: string;
		readonly written: boolean;
		readonly digests: ReadonlyArray<{ readonly path: string; readonly body_sha256: string }>;
	},
	| PublicationNotFoundError
	| NotAPublicationError
	| BundleLoadError
	| YamlParseError
	| UnsupportedFrontmatterError
	| PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Crypto.Crypto
> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.bundleRoot });
		const normalized = ConceptId.normalize(options.id);
		const id = Option.getOrElse(normalized, () => options.id);
		const concept = Option.isSome(normalized) ? bundle.concepts.get(normalized.value) : undefined;
		if (concept === undefined) return yield* new PublicationNotFoundError({ id });
		if (concept.frontmatter.type !== PUBLICATION_TYPE) {
			return yield* new NotAPublicationError({ id, type: concept.frontmatter.type });
		}
		const renders = Publications.rendersOf(concept);
		if (renders === undefined) {
			return yield* new UnsupportedFrontmatterError({ key: "renders", shape: "malformed" });
		}
		const digests: Array<{ readonly path: string; readonly body_sha256: string }> = [];
		for (const entry of renders) {
			const sourceId = Publications.resolveRef(concept.path, entry.path);
			const source = sourceId === "" ? undefined : bundle.concepts.get(sourceId as ConceptId);
			if (source === undefined) {
				return yield* new PublicationNotFoundError({ id: sourceId === "" ? entry.path : sourceId });
			}
			digests.push({ path: entry.path, body_sha256: yield* Derivation.bodyDigest(source.document.source) });
		}
		const original = concept.document.source;
		const edits = yield* FrontmatterEdits.rendersDigests(
			original,
			digests.map((d) => d.body_sha256),
		);
		const next = MarkdownEdit.applyAll(original, edits);
		if (next === original) return { id, written: false, digests };
		if (!options.dryRun) {
			const path = yield* Path.Path;
			yield* writeAtomic(path.join(bundle.root, concept.path), next);
		}
		return { id, written: true, digests };
	});
