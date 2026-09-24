/**
 * `MIN_SERVER_VERSION`: the `@okfit/lsp` version this extension was built
 * against, injected at build time by `tsdown.config.ts` as
 * `process.env.__OKFIT_LSP_VERSION__` -- never a `package.json` import at
 * runtime, the same pattern `packages/lsp/src/version.ts` uses for
 * `LSP_VERSION`.
 */
export const MIN_SERVER_VERSION: string = process.env.__OKFIT_LSP_VERSION__ as string;
