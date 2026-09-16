/**
 * okfit meta-package. Installing it provides the `okfit` and `okfit-mcp` bins.
 *
 * @packageDocumentation
 */

export { PLUGIN_VERSION } from "./version.js";

/**
 * Bins made available by installing this package.
 *
 * @public
 */
export const OKFIT_BINS = ["okfit", "okfit-mcp"] as const;
