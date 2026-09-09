/**
 * The version this server reports in `initialize`. Injected by
 * `@savvy-web/bundler` at build time (K-32); `"0.0.0"` in unbuilt source.
 *
 * @public
 */
export const MCP_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
