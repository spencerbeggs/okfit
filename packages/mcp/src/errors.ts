import { Remediation } from "@effected/kit";
import { ToolRefusal } from "@effected/mcp-kit";

/**
 * What a caller should do next about a failed tool call. Re-exported from
 * `@effected/kit`, the shape `ToolRefusal.refuse` takes. @public
 */
export { Remediation };

/**
 * The one failure schema every tool declares (N-14): `ToolRefusal` from
 * `@effected/mcp-kit`.
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
