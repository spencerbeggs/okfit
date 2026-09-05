import packageJson from "../package.json" with { type: "json" };

/**
 * The version string reported by `okfit --version`, read from the package's
 * own manifest (K-32) so a release can never desync from the printed
 * version. Consumed by `bin.ts` only.
 *
 * @public
 */
export const CLI_VERSION: string = packageJson.version;
