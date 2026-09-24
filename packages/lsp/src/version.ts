/**
 * This package's own version, what `initialize` reports in `serverInfo.version`.
 * `@savvy-web/bundler` replaces `process.env.__PACKAGE_VERSION__` with the
 * package version at build time (K-32); `"0.0.0"` is the unbuilt-source
 * fallback. The engine's version is a separate number (see
 * okf/decisions/engine-version-is-the-comparable-version-effected-kit.md).
 *
 * @public
 */
export const LSP_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
