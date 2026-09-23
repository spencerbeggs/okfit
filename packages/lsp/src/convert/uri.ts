/**
 * File URI conversion. Only `file:` URIs convert; anything else, or a
 * malformed `file:` URI, produces `Option.none()` rather than throwing.
 *
 * @packageDocumentation
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { Option } from "effect";

/**
 * `Some(absolute path)` for a `file:` URI, `None` for any other scheme or a
 * malformed `file:` URI.
 *
 * @public
 */
export const uriToPath = (uri: string): Option.Option<string> => {
	try {
		const url = new URL(uri);
		if (url.protocol !== "file:") {
			return Option.none();
		}
		return Option.some(fileURLToPath(url));
	} catch {
		return Option.none();
	}
};

/**
 * An absolute path as a percent-encoded `file://` URI.
 *
 * @public
 */
export const pathToUri = (path: string): string => pathToFileURL(path).href;
