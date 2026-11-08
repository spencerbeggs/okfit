/**
 * Free-form probe — WORKSPACE mode. Bare @okfit imports resolve to each
 * package's src/ (pnpm links workspace deps through their exports), so a
 * probe always sees the current source with no rebuild.
 *
 * Run from the repo root: pnpm scratchpad:probe probes/probe.ts
 * This file is disposable — pnpm scratchpad:reset reseeds it.
 */

import { createRequire } from "node:module";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle } from "@okfit/core";
import { Effect, Layer, Path } from "effect";

// Precondition: print the resolved effect version. A probe that measured the
// wrong version settles nothing.
const require_ = createRequire(import.meta.url);
console.log("effect", (require_("effect/package.json") as { version: string }).version);

const ROOT = "/repo/okf";
const seed = {
	[`${ROOT}/a.md`]: "---\ntype: Module\ntitle: A\n---\n\n# A\n\nSee [B](b.md).\n",
	[`${ROOT}/b.md`]: "---\ntype: Module\ntitle: B\n---\n\n# B\n\nBody.\n",
};
const platform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

const bundle = await Effect.runPromise(Bundle.load({ root: ROOT }).pipe(Effect.provide(platform)));
console.log(bundle.concepts.size);
