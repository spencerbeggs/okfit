import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { OkfitConfig } from "@okfit/core";
import { DateTime, Effect, FileSystem, Layer } from "effect";
import { MoveError } from "../../src/errors.js";
import { planMove, runMove } from "../../src/move/run.js";
import type { ProjectSeed } from "../fixtures/bundles.js";
import { V03_PROJECT } from "../fixtures/bundles.js";
import { denyAccess, mountProject, seedPlatform } from "../utils/bundle.js";

const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
const config: OkfitConfig = { ...OkfitConfig.DEFAULTS, types: { Metric: {}, "Attested Computation": {} } };
const platformFor = (seed: MemoryFileSystemSeedLike, faults?: Parameters<typeof seedPlatform>[1]) =>
	Layer.mergeAll(seedPlatform(seed, faults), NodeCrypto.layerDigest);
type MemoryFileSystemSeedLike = Parameters<typeof seedPlatform>[0];

const move = (to = "metrics/gross-margin", from = "metrics/margin", dryRun = false) => ({
	from,
	to,
	cwd: "/repo/okf",
	bundleRoot: "/repo/okf",
	config,
	now: AT,
	dryRun,
});
const plan = (seed: MemoryFileSystemSeedLike, to?: string, faults?: Parameters<typeof seedPlatform>[1]) =>
	planMove(move(to)).pipe(Effect.provide(platformFor(seed, faults)));

/** A typeless file and a concept twin carrying the same body: `mv` must treat the two bodies alike. */
interface Row {
	readonly name: string;
	readonly dir: string;
	/** `{M}` is the written link to `metrics/margin.md` from `dir`, `{G}` the link it must become. */
	readonly body: string;
	readonly expected: string;
	readonly bom?: true;
	readonly crlf?: true;
}

const ROWS: ReadonlyArray<Row> = [
	{
		name: "fenced code is left alone, the link beside it is rewritten",
		dir: "notes",
		body: "```\n[x]({M})\n```\n\n[y]({M})\n",
		expected: "```\n[x]({M})\n```\n\n[y]({G})\n",
	},
	{
		name: "inline code is left alone, the link beside it is rewritten",
		dir: "notes",
		body: "`[x]({M})` and [y]({M})\n",
		expected: "`[x]({M})` and [y]({G})\n",
	},
	{
		name: "a reference definition is rewritten",
		dir: "notes",
		body: "See [x].\n\n[x]: {M}\n",
		expected: "See [x].\n\n[x]: {G}\n",
	},
	{
		name: "an angle-bracketed link with a title keeps both",
		dir: "notes",
		body: '[x](<{M}> "t")\n',
		expected: '[x](<{G}> "t")\n',
	},
	{
		name: "CRLF line endings survive",
		dir: "notes",
		body: "# T\r\n\r\n[x]({M})\r\n",
		expected: "# T\r\n\r\n[x]({G})\r\n",
		crlf: true,
	},
	{
		name: "BOM: kept on rewrite, for a concept and a non-concept alike (#456)",
		dir: "notes",
		body: "# T\n\n[x]({M})\n",
		expected: "# T\n\n[x]({G})\n",
		bom: true,
	},
	{
		name: "a README in a subdirectory resolves its own ../",
		dir: "notes/deep",
		body: "[x]({M})\n",
		expected: "[x]({G})\n",
	},
];

const link = (dir: string, target: string): string => `${"../".repeat(dir.split("/").length)}metrics/${target}`;
const fill = (dir: string, text: string): string =>
	text.replaceAll("{M}", link(dir, "margin.md")).replaceAll("{G}", link(dir, "gross-margin.md"));

describe("mv over a non-concept file agrees with the same body in a concept", () => {
	for (const row of ROWS) {
		it.effect(row.name, () =>
			Effect.gen(function* () {
				const nl = row.crlf === true ? "\r\n" : "\n";
				const front = `---${nl}type: Metric${nl}title: Twin${nl}---${nl}${nl}`;
				const bom = row.bom === true ? "﻿" : "";
				const plainPath = `${row.dir}/plain.md`;
				const twinPath = `${row.dir}/twin.md`;
				const project: ProjectSeed = {
					...V03_PROJECT,
					[`okf/${plainPath}`]: bom + fill(row.dir, row.body),
					[`okf/${twinPath}`]: bom + front + fill(row.dir, row.body),
				};
				const result = yield* plan(mountProject(project));
				const text = (path: string) => result.edits.find((edit) => edit.path === path)?.text;
				assert.strictEqual(text(plainPath), bom + fill(row.dir, row.expected));
				assert.strictEqual(text(twinPath), bom + front + fill(row.dir, row.expected));
				// Control: the move really rewrote something in this bundle.
				assert.isDefined(text("metrics/margin-legacy.md"));
			}),
		);
	}

	it.effect("an empty frontmatter block is a non-concept: the move runs and the link is rewritten", () =>
		Effect.gen(function* () {
			const project: ProjectSeed = {
				...V03_PROJECT,
				"okf/notes/empty.md": "---\n---\n\n[x](../metrics/margin.md)\n",
			};
			const result = yield* plan(mountProject(project));
			assert.strictEqual(
				result.edits.find((edit) => edit.path === "notes/empty.md")?.text,
				"---\n---\n\n[x](../metrics/gross-margin.md)\n",
			);
			// Control: an unclosed block in the same place still refuses.
			const broken = { ...project, "okf/notes/empty.md": "---\n\n[x](../metrics/margin.md)\n" };
			const error = yield* Effect.flip(plan(mountProject(broken)));
			assert.isTrue(error instanceof MoveError && error.reason === "unloaded-files");
		}),
	);

	it.effect(
		"a non-string `type` makes a non-concept that is scanned like a concept twin; the type line is untouched",
		() =>
			Effect.gen(function* () {
				const body = "[x](../metrics/margin.md)\n";
				const project: ProjectSeed = {
					...V03_PROJECT,
					"okf/notes/typed.md": `---\ntype: 5\n---\n\n${body}`,
					"okf/notes/twin.md": `---\ntype: Metric\n---\n\n${body}`,
				};
				const result = yield* plan(mountProject(project));
				const text = (path: string) => result.edits.find((edit) => edit.path === path)?.text;
				assert.strictEqual(text("notes/typed.md"), "---\ntype: 5\n---\n\n[x](../metrics/gross-margin.md)\n");
				// Control: the concept twin with the same body is rewritten the same way.
				assert.strictEqual(text("notes/twin.md"), "---\ntype: Metric\n---\n\n[x](../metrics/gross-margin.md)\n");
			}),
	);

	it.effect("a README in a dot-directory is outside the bundle: not scanned, not blocking, bytes unchanged", () =>
		Effect.gen(function* () {
			const hidden = "[x](../metrics/margin.md)\n";
			const fs = yield* FileSystem.FileSystem;
			const { plan: ran } = yield* runMove(move());
			assert.isUndefined(ran.edits.find((edit) => edit.path === ".github/README.md"));
			assert.strictEqual(yield* fs.readFileString("/repo/okf/.github/README.md"), hidden);
			// Control: the visible README was scanned and written.
			assert.strictEqual(yield* fs.readFileString("/repo/okf/notes/README.md"), "[x](../metrics/gross-margin.md)\n");
		}).pipe(
			Effect.provide(
				platformFor(
					mountProject({
						...V03_PROJECT,
						"okf/.github/README.md": "[x](../metrics/margin.md)\n",
						"okf/notes/README.md": "[x](../metrics/margin.md)\n",
					}),
				),
			),
		),
	);

	it.effect("moving into or out of the README's directory respells its link", () =>
		Effect.gen(function* () {
			const project: ProjectSeed = {
				...V03_PROJECT,
				"okf/notes/README.md": "[x](../metrics/margin.md)\n",
				"okf/metrics/README.md": "[x](./margin.md)\n",
			};
			const into = yield* plan(mountProject(project), "notes/margin");
			assert.strictEqual(into.edits.find((edit) => edit.path === "notes/README.md")?.text, "[x](margin.md)\n");
			assert.strictEqual(
				into.edits.find((edit) => edit.path === "metrics/README.md")?.text,
				"[x](../notes/margin.md)\n",
			);
			// Control: a move inside metrics/ leaves the README beside it ./-prefixed.
			const within = yield* plan(mountProject(project));
			assert.strictEqual(
				within.edits.find((edit) => edit.path === "metrics/README.md")?.text,
				"[x](./gross-margin.md)\n",
			);
		}),
	);

	for (const name of ["README", "plain"]) {
		it.effect(`a destination that is an existing non-concept file (notes/${name}.md) collides`, () =>
			Effect.gen(function* () {
				const project: ProjectSeed = { ...V03_PROJECT, [`okf/notes/${name}.md`]: "# Notes\n" };
				const error = yield* Effect.flip(plan(mountProject(project), `notes/${name}`));
				assert.isTrue(error instanceof MoveError && error.reason === "destination-exists");
				// Control: a free destination in the same directory moves.
				const ok = yield* plan(mountProject(project), "notes/margin");
				assert.strictEqual(ok.to, "notes/margin.md");
			}),
		);
	}
});

describe("mv and symlinked non-concept files", () => {
	const OUT = "/outside/README.md";
	const LINKED = ["/repo/okf/notes/OUT.md"];
	const body = "[x](../metrics/margin.md)\n";
	const front = "---\ntype: Metric\ntitle: Twin\n---\n\n";
	const seed = {
		...mountProject(V03_PROJECT),
		"/repo/okf/notes/real.md": body,
		"/repo/okf/notes/LINK.md": MemoryFileSystem.symlink("/repo/okf/notes/real.md"),
		"/repo/okf/notes/realc.md": front + body,
		"/repo/okf/notes/LINKC.md": MemoryFileSystem.symlink("/repo/okf/notes/realc.md"),
		"/repo/okf/notes/OUT.md": MemoryFileSystem.symlink(OUT),
		[OUT]: body,
	};

	it.effect(
		"an in-bundle symlink is treated like a symlinked concept; an escaping one is never read or written",
		() => {
			const touched: Array<string> = [];
			return Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				// Control: the guard is armed, so a stray access would be caught and recorded.
				const probe = yield* Effect.flip(fs.readFileString(OUT));
				assert.strictEqual(probe._tag, "PlatformError");
				assert.deepStrictEqual(touched, [`readFileString ${OUT}`]);
				touched.length = 0;

				yield* runMove(move());
				assert.deepStrictEqual(touched, []);
				assert.strictEqual(yield* fs.readFileString("/repo/okf/notes/real.md"), "[x](../metrics/gross-margin.md)\n");
				assert.strictEqual(
					yield* fs.readFileString("/repo/okf/notes/realc.md"),
					`${front}[x](../metrics/gross-margin.md)\n`,
				);
				// The in-bundle links agree with each other, and the escaping link's target is untouched.
				const kindOf = (path: string) =>
					fs.readLink(path).pipe(
						Effect.map(() => "link"),
						Effect.orElseSucceed(() => "file"),
					);
				assert.strictEqual(yield* kindOf("/repo/okf/notes/LINK.md"), yield* kindOf("/repo/okf/notes/LINKC.md"));
				assert.strictEqual(yield* fs.readFileString("/repo/okf/notes/LINK.md"), "[x](../metrics/gross-margin.md)\n");
				assert.strictEqual(
					yield* fs.readFileString("/repo/okf/notes/LINKC.md"),
					`${front}[x](../metrics/gross-margin.md)\n`,
				);
			}).pipe(Effect.provide(platformFor(seed, denyAccess(touched, LINKED))));
		},
	);
});
