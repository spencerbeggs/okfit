import { Remediation } from "@effected/engine";
import { ToolRefusal } from "@effected/mcp";

/**
 * What a caller should do next about a failed tool call. Re-exported from
 * `@effected/engine`, the shape `ToolRefusal.refuse` takes. @public
 */
export { Remediation };

/**
 * The one failure schema every tool declares (N-14): `ToolRefusal` from
 * `@effected/mcp`.
 *
 * @remarks
 * Replaces five bespoke tagged errors. Under `failureMode: "error"` a declared
 * failure reaches the agent as `error.message` alone, so the structured fields
 * they carried were never on the wire; the reason text names them and
 * `ToolRefusal.refuse` folds the remediation in. Callers discriminate on the
 * message, never on a tag.
 *
 * @public
 */
export const McpToolError = ToolRefusal;
/** @public */
export type McpToolError = ToolRefusal;
