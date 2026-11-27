import { MarkdownEdit } from "@effected/markdown";
import type { YamlParseError } from "@effected/yaml";
import type { BundleLoadError } from "@okfit/core";
import { Bundle, ConceptId, changedWhileRead } from "@okfit/core";
import { Derivation, PUBLICATION_TYPE, ProfileKeys, Publications } from "@okfit/profiles";
import type { PlatformError } from "effect";
import { Effect, FileSystem, Option, Path, Runtime, Schema } from "effect";
import type { Digest } from "effect/crypto";
import { changedConceptIds } from "../changedDuringLoad.js";
import { FrontmatterEdits, UnsupportedFrontmatterError } from "../edits/FrontmatterEdits.js";
import type { PublicationEnvelope } from "../render/sync.js";
import { bomOf, writeAtomic } from "./write.js";

/**
 * No concept answers to `id` -- or one of a Publication's `renders` paths
 * resolves to no concept, in which case `id` names that missing source. `reason`
 * is `"changed-during-read"` when the concept exists but changed while the bundle was read, so the load left it out
 * (transient: run again); it is absent for a concept that is not there.
 *
 * @public
 */
export class PublicationNotFoundError extends Schema.TaggedError<PublicationNotFoundError>()(
	"PublicationNotFoundError",
	{
		id: Schema.String,
		publication: Schema.optionalKey(Schema.String),
		reason: Schema.optionalKey(Schema.Literals(["changed-during-read"])),
	},
) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		if (this.reason === "changed-during-read") return changedWhileRead(`${this.id}.md`);
		return this.publication === undefined
			? `no concept "${this.id}" in the bundle`
			: `a ${ProfileKeys.renders} entry of "${this.publication}" points at "${this.id}", which is not a concept in the bundle; fix that ${ProfileKeys.renders} entry`;
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
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return `"${this.id}" is a ${this.type}, not a ${PUBLICATION_TYPE}`;
	}
}

/**
 * Restamps one Publication's `x-okfit-renders[].body` digests from the current
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
	PublicationEnvelope,
	| PublicationNotFoundError
	| NotAPublicationError
	| BundleLoadError
	| YamlParseError
	| UnsupportedFrontmatterError
	| PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Digest.Digest
> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.bundleRoot });
		// A concept the load dropped because it changed under the read is not missing; say so (transient).
		const changed = new Set(changedConceptIds(bundle));
		const normalized = ConceptId.normalize(options.id);
		const id = Option.getOrElse(normalized, () => options.id);
		const concept = Option.isSome(normalized) ? bundle.concepts.get(normalized.value) : undefined;
		if (concept === undefined) {
			return yield* new PublicationNotFoundError({
				id,
				...(Option.isSome(normalized) && changed.has(normalized.value)
					? { reason: "changed-during-read" as const }
					: {}),
			});
		}
		if (concept.frontmatter.type !== PUBLICATION_TYPE) {
			return yield* new NotAPublicationError({ id, type: concept.frontmatter.type });
		}
		const renders = Publications.rendersOf(concept);
		if (renders === undefined) {
			return yield* new UnsupportedFrontmatterError({ key: ProfileKeys.renders, shape: "malformed" });
		}
		const digests: Array<PublicationEnvelope["digests"][number]> = [];
		for (const entry of renders) {
			const sourceId = Publications.resolveRef(concept.path, entry.path);
			const sourceKey = ConceptId.normalize(sourceId);
			const source = Option.isSome(sourceKey) ? bundle.concepts.get(sourceKey.value) : undefined;
			if (source === undefined) {
				return yield* new PublicationNotFoundError({
					id: sourceId === "" ? entry.path : sourceId,
					publication: id,
					...(Option.isSome(sourceKey) && changed.has(sourceKey.value)
						? { reason: "changed-during-read" as const }
						: {}),
				});
			}
			digests.push({ path: entry.path, body: yield* Derivation.bodyDigest(source.document.source) });
		}
		const original = concept.document.source;
		const edits = yield* FrontmatterEdits.rendersDigests(
			original,
			digests.map((d) => d.body),
		);
		const next = MarkdownEdit.applyAll(original, edits);
		if (next === original) return { id, written: false, digests };
		if (!options.dryRun) {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const target = path.join(bundle.root, concept.path);
			// The loader's source has no BOM (`readFileString` drops it); give it back on write.
			const bom = yield* bomOf(fs, target);
			yield* writeAtomic(target, bom + next);
		}
		return { id, written: true, digests };
	});
