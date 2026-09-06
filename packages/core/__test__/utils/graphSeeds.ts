import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Layer, Path } from "effect";

/** Root of the crafted bundle below. */
export const BROKEN_ROOT = "/repo/broken";

/**
 * Two concepts under `notes/` exercising every resolution branch: a missing
 * frontmatter `resource`, descriptor and URL sources, a body link to a
 * missing file, an external link, a self link, a non-markdown file, an
 * extension-less rooted link, a directory link, a frontmatter-less `.md`,
 * and an Attested Computation whose three path fields all miss.
 */
export const brokenSeed: MemoryFileSystemSeed = {
	[`${BROKEN_ROOT}/index.md`]: "# Root\n\n* [Notes](notes/index.md)\n",
	[`${BROKEN_ROOT}/notes/index.md`]: "# Note\n\n* [A](a.md)\n* [B](b.md)\n",
	[`${BROKEN_ROOT}/notes/a.md`]:
		"---\ntype: Note\nresource: assets/schema.json\nsources:\n  - resource: ghost/doc.md\n" +
		"  - resource: all queries in project X\n  - resource: https://example.com/spec\n---\n\n# A\n\n" +
		"[b](b.md)\n[gone](./gone.md)\n[up](../../outside.md)\n[site](https://example.com/)\n[self](#top)\n" +
		"[data](data.csv)\n[root](/notes/b)\n[dir](../notes/)\n[nofm](nofm.md)\n",
	[`${BROKEN_ROOT}/notes/b.md`]:
		"---\ntype: Attested Computation\nruntime: bigquery\ncomputation: lib/query.sql\nexecutor:\n" +
		"  resource: skills/run.md\n  receipt: [job_id]\nattester:\n  resource: check.py\n---\n\n" +
		"# Computation\n\n```sql\nSELECT 1\n```\n\nSee [a](a.md).\n",
	[`${BROKEN_ROOT}/notes/data.csv`]: "a,b\n1,2\n",
	[`${BROKEN_ROOT}/notes/nofm.md`]: "# No frontmatter\n\nBody only.\n",
};

/** memfs + posix Path layer for the crafted bundle. */
export const BrokenPlatform = Layer.mergeAll(MemoryFileSystem.layerWith(brokenSeed), Path.layer);

/** Root of the bundle below, exercising path fields that escape the bundle root (F-18). */
export const ESCAPE_ROOT = "/repo/escape";

/**
 * A root `resource` that escapes with a single `..` (case A), a nested one that needs two (case
 * B), an in-bundle miss that still dangles (case C), and a nested one whose `../` prefix resolves
 * back inside the bundle root and so stays a normal edge (case D).
 */
export const escapeSeed: MemoryFileSystemSeed = {
	[`${ESCAPE_ROOT}/index.md`]: "# Root\n",
	[`${ESCAPE_ROOT}/project.md`]: "---\ntype: Project\nresource: ../packages/core\n---\n\n# Project\n",
	[`${ESCAPE_ROOT}/modules/x.md`]: "---\ntype: Module\nresource: ../../elsewhere\n---\n\n# X\n",
	[`${ESCAPE_ROOT}/modules/y.md`]: "---\ntype: Module\nresource: missing.md\n---\n\n# Y\n",
	[`${ESCAPE_ROOT}/modules/z.md`]: "---\ntype: Module\nresource: ../modules/x.md\n---\n\n# Z\n",
};

/** memfs + posix Path layer for `escapeSeed`. */
export const EscapePlatform = Layer.mergeAll(MemoryFileSystem.layerWith(escapeSeed), Path.layer);
