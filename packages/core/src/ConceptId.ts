import type { Brand } from "effect";
import { Option, Schema } from "effect";
import { basename } from "./internal/posixPath.js";

const RESERVED_BASENAMES = new Set(["index.md", "log.md"]);

/** A posix bundle-relative path with `.md` stripped and no leading slash (D-12). @public */
export type ConceptId = string & Brand.Brand<"ConceptId">;

const isReservedFile = (path: string): boolean => RESERVED_BASENAMES.has(basename(path));

const fromPath = (path: string): Option.Option<ConceptId> => {
	if (isReservedFile(path) || !path.endsWith(".md")) return Option.none();
	return Option.some(path.slice(0, -3) as ConceptId);
};

const toPath = (id: ConceptId): string => `${id}.md`;

const normalize = (input: string): Option.Option<ConceptId> => {
	const withoutSlash = input.startsWith("/") ? input.slice(1) : input;
	const withoutExt = withoutSlash.endsWith(".md") ? withoutSlash.slice(0, -3) : withoutSlash;
	const collapsed = withoutExt.replace(/\/{2,}/g, "/").replace(/\/$/, "");
	return collapsed.length === 0 ? Option.none() : Option.some(collapsed as ConceptId);
};

/**
 * Branded concept id codec: the posix path with `.md` stripped, plus path
 * conversion, a tolerant input normaliser, and the reserved-file test (D-12).
 * @public
 */
export const ConceptId: Schema.Codec<ConceptId, string> & {
	readonly fromPath: (path: string) => Option.Option<ConceptId>;
	readonly toPath: (id: ConceptId) => string;
	readonly normalize: (input: string) => Option.Option<ConceptId>;
	readonly isReservedFile: (path: string) => boolean;
} = Object.assign(Schema.String.pipe(Schema.brand("ConceptId")), { fromPath, toPath, normalize, isReservedFile });
