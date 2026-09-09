/**
 * The version string reported by `okfit --version`. `@savvy-web/bundler`
 * replaces `process.env.__PACKAGE_VERSION__` with this package's own
 * version at build time (K-32), so a release can never desync from the
 * printed version. `"0.0.0"` is the unbuilt-source fallback and reads as
 * dev mode.
 *
 * @public
 */
export const CLI_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
