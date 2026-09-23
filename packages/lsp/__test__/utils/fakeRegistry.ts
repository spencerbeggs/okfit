import type { BundleSessionShape, RevalidateTier } from "@okfit/engine";
import { Effect, Option } from "effect";
import type { SessionHandle, SessionRegistryShape } from "../../src/session/registry.js";

/** One recorded call on the fake session or scheduler, in call order. */
export type FakeCall =
	| { readonly op: "open" | "change"; readonly path: string; readonly text: string; readonly version?: number }
	| { readonly op: "close"; readonly path: string }
	| { readonly op: "schedule"; readonly tier: RevalidateTier };

const unused = (name: string) => () => Effect.die(`fake: ${name} is not used by this test`);

/**
 * A `SessionRegistryShape` owning every path under `bundleRoot` with one
 * handle whose session and scheduler record their calls into `calls`. Any
 * member a test does not exercise dies.
 */
export const makeFakeRegistry = (
	bundleRoot: string,
): { readonly registry: SessionRegistryShape; readonly calls: Array<FakeCall> } => {
	const calls: Array<FakeCall> = [];
	const session = {
		root: bundleRoot,
		open: (path: string, text: string, version?: number) =>
			Effect.sync(() => void calls.push({ op: "open", path, text, ...(version === undefined ? {} : { version }) })),
		change: (path: string, text: string, version?: number) =>
			Effect.sync(() => void calls.push({ op: "change", path, text, ...(version === undefined ? {} : { version }) })),
		close: (path: string) => Effect.sync(() => void calls.push({ op: "close", path })),
		watchedFilesChanged: unused("watchedFilesChanged"),
		revalidate: unused("revalidate"),
		bundle: unused("bundle"),
		graph: unused("graph"),
		config: () => {
			throw new Error("fake: config is not used by this test");
		},
	} as unknown as BundleSessionShape;
	const handle: SessionHandle = {
		folder: bundleRoot,
		bundleRoot,
		session,
		scheduler: {
			schedule: (tier) => Effect.sync(() => void calls.push({ op: "schedule", tier })),
			settle: Effect.void,
		},
	};
	const registry: SessionRegistryShape = {
		setFolders: unused("setFolders"),
		addFolders: unused("addFolders"),
		removeFolders: unused("removeFolders"),
		sessionFor: (path) =>
			Effect.succeed(path.startsWith(`${bundleRoot}/`) ? Option.some(handle) : Option.none<SessionHandle>()),
		sessions: Effect.succeed([handle]),
		invalidate: unused("invalidate"),
	};
	return { registry, calls };
};
