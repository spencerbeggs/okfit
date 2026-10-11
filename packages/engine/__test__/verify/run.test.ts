import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern, ConceptId } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Derivation, Trust } from "@okfit/profiles";
import { DateTime, Effect, Layer, Option } from "effect";
import { runVerify, runVerifyBatch } from "../../src/verify/run.js";
import { DIGEST, bindFixtures } from "../utils/binding.js";

describe("runVerifyBatch (issue #138)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const decision = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true }, Module: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
	} as unknown as Git["Service"]);
	const platform = Layer.mergeAll(gitFake, NodeServices.layer);

	it.effect(
		"selects every require_verified concept lacking the actor's entry, skips drafts and repeats, writes all",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
				try {
					yield* Effect.promise(() => mkdir(join(root, "decisions")));
					yield* Effect.promise(() => writeFile(join(root, "decisions", "a.md"), decision("A")));
					yield* Effect.promise(() => writeFile(join(root, "decisions", "b.md"), decision("B", "status: draft\n")));
					yield* Effect.promise(() =>
						writeFile(
							join(root, "decisions", "c.md"),
							decision(
								"C",
								`verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\nintegrity:\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n`,
							),
						),
					);
					yield* bindFixtures(root, ["decisions/c.md"]).pipe(Effect.provide(NodeServices.layer));
					yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
					const result = yield* runVerifyBatch({
						bundleRoot: root,
						projectRoot: root,
						config,
						at: AT,
						dryRun: false,
						types: [],
					}).pipe(Effect.provide(platform));
					assert.strictEqual(result.by, "human:ada");
					assert.deepStrictEqual(
						result.verified.map((entry) => entry.id),
						["decisions/a"],
					);
					assert.deepStrictEqual(result.skipped, [
						{ id: "decisions/b", reason: "draft" },
						{ id: "decisions/c", reason: "already-verified" },
					]);
					const a = yield* Effect.promise(() => readFile(join(root, "decisions", "a.md"), "utf8"));
					assert.ok(a.includes("verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n"));
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
	);

	it.effect("skips a deprecated concept and leaves its file byte-identical (#143)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const deprecated = decision("D", "status: deprecated\n");
				yield* Effect.promise(() => writeFile(join(root, "decisions", "d.md"), deprecated));
				const result = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					types: [],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(result.verified, []);
				assert.deepStrictEqual(result.skipped, [{ id: "decisions/d", reason: "deprecated" }]);
				const after = yield* Effect.promise(() => readFile(join(root, "decisions", "d.md"), "utf8"));
				assert.strictEqual(after, deprecated);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("--type narrows to the named types and rejects an undeclared one", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
				const result = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: ["Module"],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(
					result.verified.map((entry) => entry.id),
					["module"],
				);
				const error = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: ["Nope"],
				}).pipe(Effect.provide(platform), Effect.flip);
				assert.strictEqual(error._tag, "VerifySelectionError");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("fails the whole batch, writing nothing, when one concept's verified shape is unsupported", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				yield* Effect.promise(() => writeFile(join(root, "decisions", "a.md"), decision("A")));
				yield* Effect.promise(() =>
					writeFile(join(root, "decisions", "z.md"), decision("Z", "verified: not-a-list\n")),
				);
				const before = yield* Effect.promise(() => readFile(join(root, "decisions", "a.md"), "utf8"));
				const error = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: false,
					types: [],
				}).pipe(Effect.provide(platform), Effect.flip);
				assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
				assert.strictEqual(yield* Effect.promise(() => readFile(join(root, "decisions", "a.md"), "utf8")), before);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("rejects inherited Object.prototype keys as batch types", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-batch-")));
			try {
				yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
				const error = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: ["toString"],
				}).pipe(Effect.provide(platform), Effect.flip);
				assert.strictEqual(error._tag, "VerifySelectionError");
				if (error._tag !== "VerifySelectionError") throw new Error("unreachable: asserted above");
				assert.strictEqual(error.reason, "unknown-type");
				assert.strictEqual(error.detail, "toString");
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});

describe("runVerify status (issue #185)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const VERIFIED = "verified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n";
	/** The `integrity.verified` binding a run of `AT` by ada writes for a content digest. */
	const binding = (content: string): string =>
		`integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T12:00:00Z\n    content: ${content}\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
	} as unknown as Git["Service"]);
	const platform = Layer.mergeAll(gitFake, NodeServices.layer);

	/** Write `source` as decisions/a.md, run `use`, always clean up. */
	const withConcept = <A, E>(source: string, use: (root: string, file: string) => Effect.Effect<A, E>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-status-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const file = join(root, "decisions", "a.md");
				yield* Effect.promise(() => writeFile(file, source));
				return yield* use(root, file);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});

	const run = (root: string, status: "stable" | "draft" | undefined, dryRun = false) =>
		runVerify({
			id: "decisions/a",
			bundleRoot: root,
			projectRoot: root,
			config,
			at: AT,
			dryRun,
			...(status === undefined ? {} : { status }),
		}).pipe(Effect.provide(platform));

	it.effect("replaces status: draft with stable and adds the verified block", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: draft\n---\n\nbody\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after.split("status: stable").length - 1, 1);
				assert.isFalse(after.includes("status: draft"));
				assert.isTrue(after.includes(VERIFIED));
				assert.deepStrictEqual(result.status, { from: "draft", to: "stable" });
				assert.strictEqual(result.statusFragment, "stable");
			}),
		),
	);

	it.effect("verifying a single deprecated concept by id stays allowed and leaves status untouched", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: deprecated\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, undefined);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(
					after,
					`---\ntype: Decision\ntitle: T\nstatus: deprecated\n${VERIFIED}${binding(result.content)}---\n`,
				);
				assert.isNull(result.statusFragment);
			}),
		),
	);

	it.effect("collision: status and verified both land at the end of the frontmatter", () =>
		withConcept("---\ntype: Decision\ntitle: T\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(
					after,
					`---\ntype: Decision\ntitle: T\nstatus: stable\n${VERIFIED}${binding(result.content)}---\n`,
				);
				assert.deepStrictEqual(result.status, { from: null, to: "stable" });
			}),
		),
	);

	it.effect("no-op: a quoted status already at the target is untouched", () => {
		const before = '---\ntype: Decision\ntitle: T\nstatus: "stable"\n---\n';
		return withConcept(before, (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after, before.replace("\n---\n", `\n${VERIFIED}${binding(result.content)}---\n`));
				assert.strictEqual(result.statusFragment, null);
				assert.deepStrictEqual(result.status, { from: "stable", to: "stable" });
			}),
		);
	});

	it.effect("demote: --draft rewrites status: stable", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: stable\n---\n", (root, file) =>
			Effect.gen(function* () {
				yield* run(root, "draft");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.isTrue(after.includes("status: draft\n"));
				assert.isFalse(after.includes("status: stable"));
			}),
		),
	);

	it.effect("unsupported status shape fails closed, real and dry run, file byte-identical", () => {
		const before = "---\ntype: Decision\ntitle: T\nstatus: |\n  stable\n---\n";
		return withConcept(before, (root, file) =>
			Effect.gen(function* () {
				for (const dryRun of [false, true]) {
					const error = yield* run(root, "stable", dryRun).pipe(Effect.flip);
					assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
					if (error._tag === "VerifyUnsupportedFrontmatterError") assert.strictEqual(error.key, "status");
					assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), before);
				}
			}),
		);
	});

	it.effect("CRLF + BOM: the inserted status line ends CRLF and no bare LF appears", () =>
		withConcept("\uFEFF---\r\ntype: Decision\r\ntitle: T\r\n---\r\n", (root, file) =>
			Effect.gen(function* () {
				yield* run(root, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.isTrue(after.startsWith("\uFEFF"));
				assert.isTrue(after.includes("status: stable\r\n"));
				assert.strictEqual(after.replace(/\r\n/g, "").indexOf("\n"), -1);
			}),
		),
	);

	it.effect("no flag: status is null and the status bytes are untouched", () =>
		withConcept("---\ntype: Decision\ntitle: T\nstatus: draft\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* run(root, undefined);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(result.status, null);
				assert.strictEqual(result.statusFragment, null);
				assert.isTrue(after.includes("status: draft\n"));
			}),
		),
	);
});

describe("runVerify binds integrity.verified", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const LATER = DateTime.makeUnsafe("2026-09-17T12:00:00Z");
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(Option.some(key === "user.name" ? "Ada" : "ada@example.com")),
	} as unknown as Git["Service"]);
	const platform = Layer.mergeAll(gitFake, NodeServices.layer);

	const withConcept = <A, E, R>(source: string, use: (root: string, file: string) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-bind-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const file = join(root, "decisions", "a.md");
				yield* Effect.promise(() => writeFile(file, source));
				return yield* use(root, file);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});

	const verify = (root: string, at: DateTime.Utc, status?: "stable" | "draft") =>
		runVerify({
			id: "decisions/a",
			bundleRoot: root,
			projectRoot: root,
			config,
			at,
			dryRun: false,
			...(status === undefined ? {} : { status }),
		}).pipe(Effect.provide(platform));

	const signalOf = (root: string, now: DateTime.Utc) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root });
			const concept = bundle.concepts.get("decisions/a" as ConceptId);
			if (concept === undefined) return yield* Effect.die(new Error("missing concept"));
			return yield* Trust.signal(concept, now);
		}).pipe(Effect.provide(NodeServices.layer));

	const SRC = "---\ntype: Decision\ntitle: T\n---\n\n# T\n\nBody.\n";

	it.effect("writes both keys, and the written file's own digest equals the bound one", () =>
		withConcept(SRC, (root, file) =>
			Effect.gen(function* () {
				const result = yield* verify(root, AT);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.ok(
					after.includes(
						`integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T12:00:00Z\n    content: ${result.content}\n`,
					),
				);
				assert.strictEqual(result.priorDrift, null);
				const signal = yield* signalOf(root, AT);
				assert.strictEqual(signal.integrity, "current");
				// the binding digest is the digest of the file AFTER the edit, not just before it
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(NodeServices.layer));
				const written = bundle.concepts.get("decisions/a" as ConceptId);
				assert.ok(written !== undefined);
				const recomputed = yield* Derivation.contentDigest(written.frontmatter.raw, written.document.source).pipe(
					Effect.provide(NodeServices.layer),
				);
				assert.strictEqual(recomputed, result.content);
			}),
		),
	);

	it.effect("a body edit drifts it; verifying again binds it once, never a second integrity key", () =>
		withConcept(SRC, (root, file) =>
			Effect.gen(function* () {
				yield* verify(root, AT);
				yield* Effect.promise(async () =>
					writeFile(file, (await readFile(file, "utf8")).replace("Body.", "Edited body.")),
				);
				const drifted = yield* signalOf(root, LATER);
				assert.strictEqual(drifted.integrity, "drifted");
				assert.strictEqual(drifted.drift?.reason, "content-changed");
				const second = yield* verify(root, LATER);
				assert.strictEqual(second.priorDrift, "content-changed");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(after.split("integrity:").length - 1, 1);
				assert.strictEqual(after.split("  verified:").length - 1, 1);
				assert.strictEqual((yield* signalOf(root, LATER)).integrity, "current");
			}),
		),
	);

	it.effect("--stable with both keys absent merges status, verified, integrity in that order", () =>
		withConcept("---\ntype: Decision\ntitle: T\n---\n", (root, file) =>
			Effect.gen(function* () {
				const result = yield* verify(root, AT, "stable");
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.strictEqual(
					after,
					`---\ntype: Decision\ntitle: T\nstatus: stable\nverified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\nintegrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T12:00:00Z\n    content: ${result.content}\n---\n`,
				);
				assert.strictEqual((yield* signalOf(root, AT)).integrity, "current");
			}),
		),
	);

	it.effect("replaces a malformed integrity.verified and keeps integrity.generated byte-for-byte", () => {
		const generated = "  generated:\n    # stamped by sync\n    body: 0123456789abcdef\n";
		const source = `---\ntype: Decision\ntitle: T\nintegrity:\n${generated}  verified:\n    by: nope\n---\n\nBody.\n`;
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				yield* verify(root, AT);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.ok(after.includes(`integrity:\n${generated}  verified:\n    by: human:ada\n`));
				assert.ok(!after.includes("nope"));
				assert.strictEqual(after.split("integrity:").length - 1, 1);
				assert.strictEqual((yield* signalOf(root, AT)).integrity, "current");
			}),
		);
	});

	it.effect("an unsupported integrity shape fails closed keyed integrity, file untouched", () => {
		const source = "---\ntype: Decision\ntitle: T\nintegrity: nope\n---\n";
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				const error = yield* verify(root, AT).pipe(Effect.flip);
				assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
				if (error._tag === "VerifyUnsupportedFrontmatterError") assert.strictEqual(error.key, "integrity");
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), source);
			}),
		);
	});
});
