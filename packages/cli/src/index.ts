/**
 * Programmatic surface of `@okfit/cli` itself: the command tree, the
 * failure renderer, and the human renderers for `validate` and `verify`
 * (K-48). Config discovery and the validate/verify/sync/init/context
 * programs live in `@okfit/engine` now -- import from there directly.
 *
 * @packageDocumentation
 */

export { rootCommand } from "./commands/root.js";
export { renderFailure } from "./errors.js";
export { humanContext } from "./render/context.js";
export type { Counts } from "./render/human.js";
export { human, line, summary } from "./render/human.js";
export type { VerifyLines } from "./render/verify.js";
export { humanVerify } from "./render/verify.js";
export { CLI_VERSION } from "./version.js";
