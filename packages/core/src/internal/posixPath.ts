// Posix path arithmetic on plain strings for bundle-relative ids and link
// resolution (D-27). Semantics mirror Effect's posix `Path.layer`; `resolve`
// and `relative` are absent on purpose because they read `process.cwd()`.

const SLASH = 47;

/**
 * Collapse `.`/`..` and repeated slashes. Relative input keeps leading `..`
 * (the caller classifies bundle escapes); absolute input clamps at the root.
 * A trailing slash survives; `""` is `"."`.
 *
 * @public
 */
export const normalize = (path: string): string => {
	if (path.length === 0) return ".";
	const isAbsolute = path.charCodeAt(0) === SLASH;
	const trailingSeparator = path.charCodeAt(path.length - 1) === SLASH;
	const segments: Array<string> = [];
	for (const segment of path.split("/")) {
		if (segment.length === 0 || segment === ".") continue;
		if (segment === "..") {
			if (segments.length > 0 && segments[segments.length - 1] !== "..") {
				segments.pop();
			} else if (!isAbsolute) {
				segments.push("..");
			}
			continue;
		}
		segments.push(segment);
	}
	let result = segments.join("/");
	if (result.length === 0 && !isAbsolute) result = ".";
	if (result.length > 0 && trailingSeparator) result += "/";
	return isAbsolute ? `/${result}` : result;
};

/** Join non-empty segments with `/` and normalize; no segments is `"."`. @public */
export const join = (...paths: ReadonlyArray<string>): string => {
	const joined = paths.filter((segment) => segment.length > 0).join("/");
	return joined.length === 0 ? "." : normalize(joined);
};

/** Directory part of `path`: `"."` for a bare name, `"/"` for a root-level absolute path. @public */
export const dirname = (path: string): string => {
	let end = path.length;
	while (end > 1 && path.charCodeAt(end - 1) === SLASH) end--;
	const trimmed = path.slice(0, end);
	const index = trimmed.lastIndexOf("/");
	if (index === -1) return ".";
	if (index === 0) return "/";
	return trimmed.slice(0, index);
};

/** Last segment of `path` with trailing slashes stripped; `""` for `""` or `"/"`. @public */
export const basename = (path: string): string => {
	let end = path.length;
	while (end > 0 && path.charCodeAt(end - 1) === SLASH) end--;
	const trimmed = path.slice(0, end);
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
};
