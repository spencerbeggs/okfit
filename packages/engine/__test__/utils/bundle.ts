import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { LoadedBundle } from "@okfit/core";
import { ConceptId } from "@okfit/core";
import type { FileSystem } from "effect";
import { Layer, Option, Path } from "effect";
import type { OverlayDocumentsShape } from "../../src/overlay/layer.js";
import { OverlayDocuments, layerOverlayFileSystem } from "../../src/overlay/layer.js";

/** Absolute memfs mount point of every engine seam test bundle. */
export const ROOT = "/repo/okf";

/** A minimal `Module` concept; `body` is the paragraph under the heading. */
export const moduleConcept = (title: string, body = "Body."): string =>
	`---\ntype: Module\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`;

/** Two clean concepts; `a.md` links to `b.md`. */
export const SEED: MemoryFileSystemSeed = {
	[`${ROOT}/a.md`]: moduleConcept("A", "See [B](b.md)."),
	[`${ROOT}/b.md`]: moduleConcept("B"),
};

/** The loaded source text of the concept at bundle-relative `file`, or `undefined`. */
export const sourceOf = (bundle: LoadedBundle, file: string): string | undefined =>
	Option.match(ConceptId.fromPath(file), {
		onNone: () => undefined,
		onSome: (id) => bundle.concepts.get(id)?.document.source,
	});

/**
 * memfs under the overlay, plus the overlay service itself and posix `Path`. The
 * caller keeps `documents` so it can open/change/close from inside the test.
 */
export const overlayPlatform = (
	seed: MemoryFileSystemSeed,
	documents: OverlayDocumentsShape,
): Layer.Layer<FileSystem.FileSystem | Path.Path | OverlayDocuments> => {
	const overlay = Layer.succeed(OverlayDocuments, documents);
	return Layer.mergeAll(
		layerOverlayFileSystem.pipe(Layer.provide(Layer.mergeAll(MemoryFileSystem.layerWith(seed), overlay))),
		overlay,
		Path.layer,
	);
};
