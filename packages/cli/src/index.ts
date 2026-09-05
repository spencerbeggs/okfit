/**
 * Programmatic surface of the okfit command line.
 *
 * @packageDocumentation
 */

export { rootCommand } from "./commands/root.js";
export type { DiscoveredConfig } from "./config/anchor.js";
export { resolveBundleRoot, resolveProjectRoot } from "./config/anchor.js";
export { buildConfigLayer, provideConfig } from "./config/layer.js";
export { ConfigMalformedError, ConfigPathNotFoundError, InitOverwriteError, renderFailure } from "./errors.js";

/**
 * The version string reported by `okfit --version`.
 *
 * @public
 */
export const CLI_VERSION = "0.0.0";
