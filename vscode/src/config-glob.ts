/**
 * The glob for an okfit config file at any depth, shared by the extension
 * manifest's `activationEvents` (`package.json`) and the language client's
 * file-system watcher (`client.ts`) -- `__test__/manifest.test.ts` pins the
 * manifest's copy to this one so the two can never drift apart silently.
 */
export const CONFIG_GLOB = "**/{.okfit.toml,okfit.toml,.config/okfit.toml}";
