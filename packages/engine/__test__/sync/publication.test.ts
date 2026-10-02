import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Derivation } from "@okfit/profiles";
import { Effect } from "effect";
import { NotAPublicationError, PublicationNotFoundError, stampPublication } from "../../src/sync/publication.js";

const withBundle = <A, E>(
	files: Record<string, string>,
	use: (
		root: string,
	) => Effect.Effect<
		A,
		E,
		import("effect").FileSystem.FileSystem | import("effect").Path.Path | import("effect").Crypto.Crypto
	>,
) =>
	Effect.gen(function* () {
		const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-stamp-")));
		return yield* Effect.gen(function* () {
			for (const [name, text] of Object.entries(files)) {
				yield* Effect.promise(async () => {
					await mkdir(join(root, name, ".."), { recursive: true });
					await writeFile(join(root, name), text);
				});
			}
			return yield* use(root);
		}).pipe(Effect.ensuring(Effect.promise(() => rm(root, { recursive: true, force: true }))));
	}).pipe(Effect.provide(NodeServices.layer));

const MOD_A = "---\ntype: Module\ntitle: A\n---\n\n# A\n";
const MOD_B = "---\ntype: Module\ntitle: B\n---\n\n# B\n";
const pubFile = (renders: string): string =>
	`---\ntype: Publication\nresource: page.md\nsurface: surfaces/s\nrenders:\n${renders}\n---\n\nNotes.\n`;
const PUB = pubFile("  - path: ../modules/a.md\n  - path: ../modules/b.md");
const files = { "modules/a.md": MOD_A, "modules/b.md": MOD_B, "publications/p.md": PUB };

describe("stampPublication", () => {
	it.effect("stamps every entry, then is a no-op on the second run", () =>
		withBundle(files, (root) =>
			Effect.gen(function* () {
				const da = yield* Derivation.bodyDigest(MOD_A);
				const db = yield* Derivation.bodyDigest(MOD_B);
				const first = yield* stampPublication({ bundleRoot: root, id: "publications/p", dryRun: false });
				assert.strictEqual(first.written, true);
				assert.deepStrictEqual(first.digests, [
					{ path: "../modules/a.md", body_sha256: da },
					{ path: "../modules/b.md", body_sha256: db },
				]);
				const after = yield* Effect.promise(() => readFile(join(root, "publications/p.md"), "utf8"));
				assert.ok(after.includes(`body_sha256: ${da}`) && after.includes(`body_sha256: ${db}`));
				const second = yield* stampPublication({ bundleRoot: root, id: "publications/p", dryRun: false });
				assert.strictEqual(second.written, false);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "publications/p.md"), "utf8")), after);
			}),
		),
	);

	it.effect("writes nothing on dryRun but reports written: true", () =>
		withBundle(files, (root) =>
			Effect.gen(function* () {
				const result = yield* stampPublication({ bundleRoot: root, id: "publications/p", dryRun: true });
				assert.strictEqual(result.written, true);
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "publications/p.md"), "utf8")), PUB);
			}),
		),
	);

	it.effect("fails PublicationNotFoundError for an unknown id", () =>
		withBundle(files, (root) =>
			Effect.map(Effect.flip(stampPublication({ bundleRoot: root, id: "publications/nope", dryRun: false })), (e) => {
				assert.ok(e instanceof PublicationNotFoundError);
				assert.strictEqual(e.id, "publications/nope");
			}),
		),
	);

	it.effect("fails NotAPublicationError for a Module", () =>
		withBundle(files, (root) =>
			Effect.map(Effect.flip(stampPublication({ bundleRoot: root, id: "modules/a", dryRun: false })), (e) => {
				assert.ok(e instanceof NotAPublicationError);
				assert.strictEqual(e.type, "Module");
			}),
		),
	);

	it.effect(
		"fails PublicationNotFoundError naming the source id for an unresolvable renders path, writing nothing",
		() => {
			const bad = pubFile("  - path: ../modules/a.md\n  - path: ../modules/ghost.md");
			return withBundle({ ...files, "publications/p.md": bad }, (root) =>
				Effect.gen(function* () {
					const e = yield* Effect.flip(stampPublication({ bundleRoot: root, id: "publications/p", dryRun: false }));
					assert.ok(e instanceof PublicationNotFoundError);
					assert.strictEqual(e.id, "modules/ghost");
					assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "publications/p.md"), "utf8")), bad);
				}),
			);
		},
	);
});
