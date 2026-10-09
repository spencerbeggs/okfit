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
export { InitBundleDirError } from "./internal/initWizard.js";
export { DocumentStdinIsTerminalError } from "./internal/stdin.js";
export { humanContext } from "./render/context.js";
export type { Counts, HumanDocOptions, SeverityPaint } from "./render/human.js";
export { annotationDir, human, humanDoc, line, summary } from "./render/human.js";
export { humanStale, humanStaleDoc } from "./render/stale.js";
export type { VerifyLines } from "./render/verify.js";
export { humanVerify, humanVerifyBatchDoc, humanVerifyDoc } from "./render/verify.js";
export { CLI_VERSION } from "./version.js";
