/**
 * The command ids and code action kinds `server.ts` advertises in
 * `INITIALIZE_RESULT.capabilities`, shared with the features that implement
 * them (code actions, execute-command, inlay hints -- LSP roadmap phase 5)
 * and copied into the VS Code extension so both sides agree on the exact
 * strings without either importing the other.
 *
 * @packageDocumentation
 */

/** Command ids the server advertises in `executeCommandProvider.commands`. @public */
export const OKFIT_COMMANDS = ["okfit.setStatus", "okfit.markVerified", "okfit.revalidate"] as const;

/** Code action kinds the server advertises in `codeActionProvider.codeActionKinds`. @public */
export const OKFIT_CODE_ACTION_KINDS = ["quickfix", "okfit.status", "okfit.verify"] as const;
