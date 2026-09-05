/**
 * K-7: exits `1` and `2` are a SUCCESSFUL run that found diagnostics, never
 * an Effect failure. The handler writes the code here and returns `void`.
 * The only writer of `process.exitCode` in this package.
 *
 * @public
 */
export const setExitCode = (code: 0 | 1 | 2): void => {
	process.exitCode = code;
};
