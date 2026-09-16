/**
 * The version this engine reports as `engine_version` in every JSON
 * envelope. `@savvy-web/bundler` replaces `process.env.__PACKAGE_VERSION__`
 * with this package's own version at build time (K-32), so a release can
 * never desync from the printed version. `"0.0.0"` is the unbuilt-source
 * fallback and reads as dev mode. This is the ONE `process` read this
 * package's own `boundaries.test.ts` allowlists — see that file and this
 * package's `CLAUDE.md` for why it is safe here even though every other
 * `process` read is forbidden.
 *
 * @public
 */
export const ENGINE_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
