/**
 * okfit meta-package. Installing it provides the `okfit`, `okfit-mcp` and
 * `okfit-lsp` bins.
 *
 * @packageDocumentation
 */

export { PLUGIN_VERSION } from "./version.js";

/**
 * Bins made available by installing this package.
 *
 * @public
 */
export const OKFIT_BINS = ["okfit", "okfit-mcp", "okfit-lsp"] as const;
