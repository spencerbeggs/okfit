import type { ServerLaunch } from "./resolve-server.js";

export type CandidateDecision = "keep" | "try-next";

/**
 * Pure decision for whether a just-started candidate's missing
 * `okfit/concepts` capability should be tolerated (`"keep"`) or should
 * trigger falling through to the next candidate (`"try-next"`). Only a
 * `"workspace"`-sourced candidate without the capability is worth retrying
 * automatically -- a `"setting"` source is the user's explicit choice, kept
 * as-is so the existing `okfit.serverTooOld` UI shows; the bundled sources
 * (`"bundled"`, `"bundled-path-node"`) are always the last candidate
 * `resolveServer` builds, so there is nothing left to retry into. Any
 * candidate that does have the capability is always kept.
 */
export const nextCandidate = (source: ServerLaunch["source"], hasCapability: boolean): CandidateDecision =>
	hasCapability || source !== "workspace" ? "keep" : "try-next";
