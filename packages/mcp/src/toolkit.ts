import { Toolkit } from "effect/unstable/ai";
import { describeVocabulary, handleDescribeVocabulary } from "./tools/describeVocabulary.js";

/**
 * The six read-only tools (N-10). Tasks C1, C2 and C3 each add two; the
 * order here is the tool set's own order and is what
 * `agents/okf-docs.md`'s `tools:` allowlist mirrors.
 *
 * @public
 */
export const OkfitToolkit = Toolkit.make(describeVocabulary);

/**
 * The handler layer. `projectRoot` is closed over from the bin (N-21);
 * the bundle itself reloads on every call inside each handler (N-9).
 *
 * @public
 */
export const ToolsLayer = (projectRoot: string) =>
	OkfitToolkit.toLayer({
		describe_vocabulary: () => handleDescribeVocabulary(projectRoot),
	});
