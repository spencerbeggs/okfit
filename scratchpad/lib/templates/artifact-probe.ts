/**
 * Artifact probe — runs the BUILT prod artifact (dist/prod/npm/pkg) while
 * typing it with the workspace (dev-build) surface, for "does the published
 * artifact behave the same" questions. The double cast through unknown is
 * required: dev and prod declarations of private-field classes are nominally
 * distinct.
 *
 * Build the target first: pnpm build --filter @okfit/core
 * Run from the repo root:  pnpm scratchpad:probe probes/artifact-probe.ts
 * (The relative path below is written for this file's seeded home, probes/.)
 */
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";

const artifact = (await import(
	"../../packages/core/dist/prod/npm/pkg/index.js"
)) as unknown as typeof import("@okfit/core");

const ROOT = "/repo/okf";
const seed = {
	[`${ROOT}/a.md`]: "---\ntype: Module\ntitle: A\n---\n\n# A\n\nSee [B](b.md).\n",
	[`${ROOT}/b.md`]: "---\ntype: Module\ntitle: B\n---\n\n# B\n\nBody.\n",
};
const platform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

const bundle = await Effect.runPromise(artifact.Bundle.load({ root: ROOT }).pipe(Effect.provide(platform)));
console.log(bundle.concepts.size);
