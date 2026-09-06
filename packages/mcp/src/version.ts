import packageJson from "../package.json" with { type: "json" };

/**
 * The version this server reports in `initialize`, read from its own
 * manifest (K-32) so a release can never desync from the reported version.
 *
 * @public
 */
export const MCP_VERSION: string = packageJson.version;
