import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Git } from "@effected/git";
import type { Actor } from "@okfit/core";
import { OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Layer, Option } from "effect";

export const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");

export const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	types: { Decision: { require_verified: true }, Module: { require_verified: true } },
	actors: { humans: ["human:ada" as Actor] },
	extensions: {},
});

/** A fake `Git` whose identity resolves to `human:ada`. */
export const platform = Layer.mergeAll(
	Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
	} as unknown as Git["Service"]),
	NodeServices.layer,
);

const concept = (type: string, title: string, extra = "", description?: string): string =>
	`---\ntype: ${type}\ntitle: ${title}\n${description === undefined ? "" : `description: ${description}\n`}${extra}---\n\n# ${title}\n`;

export const FILES: ReadonlyArray<readonly [string, string]> = [
	["decisions/a.md", concept("Decision", "Alpha", "status: draft\n", "first choice")],
	["decisions/b.md", concept("Decision", "Beta")],
	["decisions/c.md", concept("Decision", "Gamma", "verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n")],
	["modules/m.md", concept("Module", "Mu", "verified:\n  - by: human:bob\n    at: 2026-09-01T00:00:00Z\n")],
];

/** A temp bundle with `files`, removed afterwards. */
export const withBundle = <A, E, R>(
	files: ReadonlyArray<readonly [string, string]>,
	body: (root: string) => Effect.Effect<A, E, R>,
) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => {
			const root = await mkdtemp(join(tmpdir(), "okfit-picker-"));
			for (const [name, text] of files) {
				await mkdir(join(root, name, ".."), { recursive: true });
				await writeFile(join(root, name), text);
			}
			return root;
		}),
		body,
		(root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
	);

export const read = (root: string, file: string) => Effect.promise(() => readFile(join(root, file), "utf8"));
