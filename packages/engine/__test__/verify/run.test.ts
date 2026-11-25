import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern, ConceptId } from "@okfit/core";
import { Bundle, Derive, OkfitConfig } from "@okfit/core";
import { Derivation, Trust } from "@okfit/profiles";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { VerifyNotCurrentError, VerifyStatusUnknownError } from "../../src/errors.js";
import {
	inspectDrift,
	loadPickerCandidates,
	loadStaleCandidates,
	runVerify,
	runVerifyBatch,
} from "../../src/verify/run.js";
import { DIGEST, bindFixtures } from "../utils/binding.js";
import { identityConfigGet } from "../utils/gitIdentity.js";
import { TestPlatform } from "../utils/platform.js";

describe("runVerifyBatch (issue #138)", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const decision = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true }, Module: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Git.layerTest({
		configGet: identityConfigGet,
	});
	const platform = Layer.mergeAll(gitFake, TestPlatform);

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
								`verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\nx-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n`,
							),
						),
					);
					yield* bindFixtures(root, ["decisions/c.md"]).pipe(Effect.provide(TestPlatform));
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
	/** The `x-okfit-integrity.verified` binding a run of `AT` by ada writes for a content digest. */
	const binding = (content: string): string =>
		`x-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T12:00:00Z\n    content: ${content}\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Git.layerTest({
		configGet: identityConfigGet,
	});
	const platform = Layer.mergeAll(gitFake, TestPlatform);

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

	it.effect(
		"a frontmatter value with an unpaired surrogate is refused, real and dry run, file byte-identical (okfit#327)",
		() => {
			const before = '---\ntype: Decision\ntitle: "x\\uD800"\n---\n';
			return withConcept(before, (root, file) =>
				Effect.gen(function* () {
					for (const dryRun of [false, true]) {
						const error = yield* run(root, "stable", dryRun).pipe(Effect.flip);
						assert.strictEqual(error._tag, "VerifyContentUnhashableError");
						if (error._tag === "VerifyContentUnhashableError") assert.deepStrictEqual(error.path, ["title"]);
						assert.include(error.message, "title cannot be hashed");
						assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), before);
					}
				}),
			);
		},
	);

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

describe("runVerify binds x-okfit-integrity.verified", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const LATER = DateTime.makeUnsafe("2026-09-17T12:00:00Z");
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Git.layerTest({
		configGet: identityConfigGet,
	});
	const platform = Layer.mergeAll(gitFake, TestPlatform);

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
			const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(TestPlatform));
			const concept = bundle.concepts.get("decisions/a" as ConceptId);
			if (concept === undefined) return yield* Effect.die(new Error("missing concept"));
			return yield* Trust.signal(concept, OkfitConfig.DEFAULTS, now);
		}).pipe(Effect.provide(TestPlatform));

	const SRC = "---\ntype: Decision\ntitle: T\n---\n\n# T\n\nBody.\n";

	it.effect("writes both keys, and the written file's own digest equals the bound one", () =>
		withConcept(SRC, (root, file) =>
			Effect.gen(function* () {
				const result = yield* verify(root, AT);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.ok(
					after.includes(
						`x-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T12:00:00Z\n    content: ${result.content}\n`,
					),
				);
				assert.strictEqual(result.priorDrift, null);
				const signal = yield* signalOf(root, AT);
				assert.strictEqual(signal.integrity, "current");
				// the binding digest is the digest of the file AFTER the edit, not just before it
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(TestPlatform));
				const written = bundle.concepts.get("decisions/a" as ConceptId);
				assert.ok(written !== undefined);
				const recomputed = yield* Derivation.contentDigest(written.frontmatter.raw, written.document.source).pipe(
					Effect.provide(TestPlatform),
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
				assert.strictEqual(after.split("x-okfit-integrity:").length - 1, 1);
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
					`---\ntype: Decision\ntitle: T\nstatus: stable\nverified:\n  - by: human:ada\n    at: 2026-09-16T12:00:00Z\nx-okfit-integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-16T12:00:00Z\n    content: ${result.content}\n---\n`,
				);
				assert.strictEqual((yield* signalOf(root, AT)).integrity, "current");
			}),
		),
	);

	it.effect(
		"replaces a malformed x-okfit-integrity.verified and keeps x-okfit-integrity.generated byte-for-byte",
		() => {
			const generated = "  generated:\n    # stamped by sync\n    body: 0123456789abcdef\n";
			const source = `---\ntype: Decision\ntitle: T\nx-okfit-integrity:\n${generated}  verified:\n    by: nope\n---\n\nBody.\n`;
			return withConcept(source, (root, file) =>
				Effect.gen(function* () {
					yield* verify(root, AT);
					const after = yield* Effect.promise(() => readFile(file, "utf8"));
					assert.ok(after.includes(`x-okfit-integrity:\n${generated}  verified:\n    by: human:ada\n`));
					assert.ok(!after.includes("nope"));
					assert.strictEqual(after.split("x-okfit-integrity:").length - 1, 1);
					assert.strictEqual((yield* signalOf(root, AT)).integrity, "current");
				}),
			);
		},
	);

	for (const [name, block] of [
		["a block holding generated", "integrity:\n  generated:\n    body: 0123456789abcdef\n"],
		["a bare key", "integrity:\n"],
		["a block that merges another mapping in", "integrity:\n  <<: { generated: { body: 0123456789abcdef } }\n"],
	] as const) {
		it.effect(`a concept holding only a legacy integrity block (${name}) fails legacy-key and names okfit sync`, () => {
			const source = `---\ntype: Decision\ntitle: T\n${block}---\n`;
			return withConcept(source, (root, file) =>
				Effect.gen(function* () {
					const error = yield* verify(root, AT).pipe(Effect.flip);
					assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
					if (error._tag === "VerifyUnsupportedFrontmatterError") {
						assert.strictEqual(error.key, "x-okfit-integrity");
						assert.strictEqual(error.shape, "legacy-key");
						assert.include(error.message, "okfit sync");
					}
					assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), source);
				}),
			);
		});
	}

	it.effect("an unsupported integrity shape fails closed keyed integrity, file untouched", () => {
		const source = "---\ntype: Decision\ntitle: T\nx-okfit-integrity: nope\n---\n";
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				const error = yield* verify(root, AT).pipe(Effect.flip);
				assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
				if (error._tag === "VerifyUnsupportedFrontmatterError") assert.strictEqual(error.key, "x-okfit-integrity");
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), source);
			}),
		);
	});
});

describe("runVerify refuses a status outside the vocabulary (OKF 0.3 5.4, R7/R11)", () => {
	const AT = DateTime.makeUnsafe("2026-11-23T12:00:00Z");
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true } },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const platform = Layer.mergeAll(Git.layerTest({ configGet: identityConfigGet }), TestPlatform);
	const doc = (status: string): string => `---\ntype: Decision\ntitle: T\nstatus: ${status}\n---\n\n# T\n`;
	const seed: Readonly<Record<string, string>> = {
		archived: doc("archived"),
		numeric: doc("5"),
		empty: doc('""'),
		nulled: doc("null"),
	};

	it.effect('refuses archived and 5, verifies "" and null, and a --stable write fixes archived', () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-unknown-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				for (const [name, text] of Object.entries(seed)) {
					yield* Effect.promise(() => writeFile(join(root, "decisions", `${name}.md`), text));
				}
				const base = { bundleRoot: root, projectRoot: root, config, at: AT, dryRun: false } as const;
				for (const [name, raw] of [
					["archived", "archived"],
					["numeric", "5"],
				] as const) {
					const error = yield* Effect.flip(
						runVerify({ ...base, id: `decisions/${name}` }).pipe(Effect.provide(platform)),
					);
					assert.strictEqual(error._tag, "VerifyStatusUnknownError", name);
					assert.strictEqual((error as VerifyStatusUnknownError).status, raw);
					assert.strictEqual(
						error.message,
						`"decisions/${name}" has status "${raw}", which is not draft, stable or deprecated; fix the status (or pass --stable or --draft) before verifying`,
					);
					const after = yield* Effect.promise(() => readFile(join(root, "decisions", `${name}.md`), "utf8"));
					assert.strictEqual(after, seed[name], "nothing written");
				}
				// a plain dry run (no --stable/--draft) is refused too, and a fixing dry run is not
				const dry = yield* Effect.flip(
					runVerify({ ...base, id: "decisions/archived", dryRun: true }).pipe(Effect.provide(platform)),
				);
				assert.strictEqual(dry._tag, "VerifyStatusUnknownError");
				const fixing = yield* runVerify({ ...base, id: "decisions/numeric", status: "stable", dryRun: true }).pipe(
					Effect.provide(platform),
				);
				assert.deepStrictEqual(fixing.status, { from: "5", to: "stable" });
				// controls: an empty or null status reads stable (11.2 rule 1) and verifies
				for (const name of ["empty", "nulled"]) {
					const ok = yield* runVerify({ ...base, id: `decisions/${name}` }).pipe(Effect.provide(platform));
					assert.strictEqual(ok.id, `decisions/${name}`);
				}
				// R11: the write that replaces the status is the way out
				const fixed = yield* runVerify({ ...base, id: "decisions/archived", status: "stable" }).pipe(
					Effect.provide(platform),
				);
				assert.deepStrictEqual(fixed.status, { from: "archived", to: "stable" });
				const text = yield* Effect.promise(() => readFile(join(root, "decisions", "archived.md"), "utf8"));
				assert.include(text, "status: stable\n");
				const numeric = yield* runVerify({ ...base, id: "decisions/numeric", status: "draft", dryRun: true }).pipe(
					Effect.provide(platform),
				);
				assert.deepStrictEqual(numeric.status, { from: "5", to: "draft" });
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);

	it.effect("batch selection skips an unknown status as unknown-status and verifies the rest", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-unknown-batch-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				for (const [name, text] of Object.entries(seed)) {
					yield* Effect.promise(() => writeFile(join(root, "decisions", `${name}.md`), text));
				}
				const result = yield* runVerifyBatch({
					bundleRoot: root,
					projectRoot: root,
					config,
					at: AT,
					dryRun: true,
					types: [],
				}).pipe(Effect.provide(platform));
				assert.deepStrictEqual(result.skipped, [
					{ id: "decisions/archived", reason: "unknown-status" },
					{ id: "decisions/numeric", reason: "unknown-status" },
				]);
				assert.deepStrictEqual(
					result.verified.map((entry) => entry.id),
					["decisions/empty", "decisions/nulled"],
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});

describe("runVerify and runVerifyBatch refuse a verification that would not be current (OKF 0.3 5.3, R33)", () => {
	const GENERATED = "2026-09-16T12:00:00Z";
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true } },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const platform = Layer.mergeAll(Git.layerTest({ configGet: identityConfigGet }), TestPlatform);
	const doc = (title: string, extra: string): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const generated = `generated:\n  by: process:sync\n  at: ${GENERATED}\n`;
	const base = (root: string, at: string) => ({
		bundleRoot: root,
		projectRoot: root,
		config,
		at: DateTime.makeUnsafe(at),
		dryRun: false,
	});
	const withRoot = <A, E, R>(files: Record<string, string>, body: (root: string) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-verify-current-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				for (const [name, text] of Object.entries(files)) {
					yield* Effect.promise(() => writeFile(join(root, name), text));
				}
				return yield* body(root);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});
	const read = (root: string, file: string) => Effect.promise(() => readFile(join(root, file), "utf8"));

	it.effect(
		"--at one second before generated.at fails VerifyNotCurrentError and leaves the file byte-identical",
		() => {
			const seed = doc("A", generated);
			return withRoot({ "decisions/a.md": seed }, (root) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(
						runVerify({ ...base(root, "2026-09-16T11:59:59Z"), id: "decisions/a" }).pipe(Effect.provide(platform)),
					);
					assert.strictEqual(error._tag, "VerifyNotCurrentError");
					assert.strictEqual((error as VerifyNotCurrentError).at, "2026-09-16T11:59:59Z");
					assert.strictEqual((error as VerifyNotCurrentError).generatedAt, GENERATED);
					assert.strictEqual(yield* read(root, "decisions/a.md"), seed);
					// a dry run is refused too: no prompt or preview for a write that cannot happen
					const dry = yield* Effect.flip(
						runVerify({ ...base(root, "2026-09-16T11:59:59Z"), id: "decisions/a", dryRun: true }).pipe(
							Effect.provide(platform),
						),
					);
					assert.strictEqual(dry._tag, "VerifyNotCurrentError");
					// control: the same call at generated.at writes, and the file changes
					const ok = yield* runVerify({ ...base(root, GENERATED), id: "decisions/a" }).pipe(Effect.provide(platform));
					assert.strictEqual(ok.at, GENERATED);
					const after = yield* read(root, "decisions/a.md");
					assert.notStrictEqual(after, seed);
					assert.include(after, `by: human:ada\n    at: ${GENERATED}\n`);
					const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(TestPlatform));
					assert.strictEqual(
						Derive.trustTier(bundle.concepts.get("decisions/a" as ConceptId)?.frontmatter as never),
						"human-reviewed",
					);
				}),
			);
		},
	);

	it.effect("a generated.at in the future (clock skew) is refused for the real clock too", () =>
		withRoot({ "decisions/a.md": doc("A", "generated:\n  by: process:sync\n  at: 2030-01-01T00:00:00Z\n") }, (root) =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					runVerify({ ...base(root, "2026-09-16T12:00:00Z"), id: "decisions/a" }).pipe(Effect.provide(platform)),
				);
				assert.strictEqual(error._tag, "VerifyNotCurrentError");
				assert.strictEqual((error as VerifyNotCurrentError).generatedAt, "2030-01-01T00:00:00Z");
				assert.notInclude(error.message, "Nothing was written"); // control: the single-concept wording is unchanged
			}),
		),
	);

	it.effect("a concept with no generated.at accepts any at", () =>
		withRoot(
			{ "decisions/a.md": doc("A", ""), "decisions/b.md": doc("B", "generated:\n  by: process:sync\n") },
			(root) =>
				Effect.gen(function* () {
					for (const name of ["a", "b"]) {
						const ok = yield* runVerify({ ...base(root, "1999-01-01T00:00:00Z"), id: `decisions/${name}` }).pipe(
							Effect.provide(platform),
						);
						assert.strictEqual(ok.at, "1999-01-01T00:00:00Z", name);
					}
				}),
		),
	);

	it.effect("runVerifyBatch verifies the rest and reports the not-current concept as skipped (#470)", () => {
		const stale = doc("S", generated);
		const fine = doc("F", "");
		return withRoot({ "decisions/f.md": fine, "decisions/s.md": stale }, (root) =>
			Effect.gen(function* () {
				const result = yield* runVerifyBatch({ ...base(root, "2026-09-16T11:00:00Z"), types: [] }).pipe(
					Effect.provide(platform),
				);
				assert.deepStrictEqual(
					result.verified.map((entry) => entry.id),
					["decisions/f"],
				);
				assert.deepStrictEqual(result.skipped, [{ id: "decisions/s", reason: "not-current" }]);
				assert.notStrictEqual(yield* read(root, "decisions/f.md"), fine);
				assert.strictEqual(yield* read(root, "decisions/s.md"), stale);
				// control: at generated.at the same concept is a candidate
				const ok = yield* runVerifyBatch({ ...base(root, GENERATED), types: [] }).pipe(Effect.provide(platform));
				assert.include(
					ok.verified.map((entry) => entry.id),
					"decisions/s",
				);
				assert.notStrictEqual(yield* read(root, "decisions/s.md"), stale);
			}),
		);
	});

	it.effect("a backdated at is not-current for a concept changed after it (#470)", () => {
		const past = doc("P", "generated:\n  by: process:sync\n  at: 2026-09-10T00:00:00Z\n");
		return withRoot({ "decisions/p.md": past }, (root) =>
			Effect.gen(function* () {
				const backdated = yield* runVerifyBatch({ ...base(root, "2026-09-09T00:00:00Z"), types: [] }).pipe(
					Effect.provide(platform),
				);
				assert.deepStrictEqual(backdated.skipped, [{ id: "decisions/p", reason: "not-current" }]);
				assert.deepStrictEqual(backdated.verified, []);
				assert.strictEqual(yield* read(root, "decisions/p.md"), past);
				// control: a past stamp is verifiable with at after it
				const now = yield* runVerifyBatch({ ...base(root, "2026-09-16T00:00:00Z"), types: [] }).pipe(
					Effect.provide(platform),
				);
				assert.deepStrictEqual(now.skipped, []);
				assert.strictEqual(now.verified.length, 1);
			}),
		);
	});

	it.effect(
		"runVerify on one not-current id still fails VerifyNotCurrentError; the kind follows how far ahead it is",
		() =>
			withRoot({ "decisions/a.md": doc("A", generated) }, (root) =>
				Effect.gen(function* () {
					const kindAt = (at: string, now: string | undefined) =>
						Effect.map(
							Effect.flip(
								runVerify({
									...base(root, at),
									...(now === undefined ? {} : { now: DateTime.makeUnsafe(now) }),
									id: "decisions/a",
								}).pipe(Effect.provide(platform)),
							),
							(error) => {
								assert.strictEqual(error._tag, "VerifyNotCurrentError");
								return (error as VerifyNotCurrentError).kind;
							},
						);
					// GENERATED is 2026-09-16T12:00:00Z; the tolerance is 5 minutes
					assert.strictEqual(yield* kindAt("2026-09-16T11:00:00Z", "2026-09-16T11:00:00Z"), "future");
					assert.strictEqual(yield* kindAt("2026-09-16T11:00:00Z", "2026-09-16T11:54:59Z"), "future");
					assert.strictEqual(yield* kindAt("2026-09-16T11:00:00Z", "2026-09-16T11:55:00Z"), "near-future");
					assert.strictEqual(yield* kindAt("2026-09-16T11:00:00Z", "2026-09-16T11:59:59Z"), "near-future");
					// now is not before generated.at: only the verification time is, so there is no kind
					assert.strictEqual(yield* kindAt("2026-09-16T11:59:59Z", "2026-09-17T00:00:00Z"), undefined);
					assert.strictEqual(yield* kindAt("2026-09-16T11:59:59Z", "2026-09-16T12:00:00Z"), undefined);
					// now omitted: the engine never claims "later than now" without knowing now
					assert.strictEqual(yield* kindAt("2026-09-16T11:59:59Z", undefined), undefined);
				}),
			),
	);

	it.effect(
		"a future generated.at with a verification between now and it is kind blocked, with that verification",
		() => {
			const future = "generated:\n  by: process:sync\n  at: 2030-06-01T00:00:00Z\n";
			const verified = "verified:\n  - by: human:ada\n    at: 2029-01-01T00:00:00Z\n";
			const refusal = (extra: string) =>
				withRoot({ "decisions/a.md": doc("A", future + extra) }, (root) =>
					Effect.gen(function* () {
						const error = yield* Effect.flip(
							runVerify({
								...base(root, "2026-11-24T00:00:00Z"),
								now: DateTime.makeUnsafe("2026-11-24T00:00:00Z"),
								id: "decisions/a",
							}).pipe(Effect.provide(platform)),
						);
						assert.strictEqual(error._tag, "VerifyNotCurrentError");
						return error as VerifyNotCurrentError;
					}),
				);
			return Effect.gen(function* () {
				const blocked = yield* refusal(verified);
				assert.strictEqual(blocked.kind, "blocked");
				assert.strictEqual(blocked.blockedBy, "2029-01-01T00:00:00Z");
				// control: the same concept without the verification is plain future
				const plain = yield* refusal("");
				assert.strictEqual(plain.kind, "future");
				assert.isUndefined(plain.blockedBy);
			});
		},
	);

	it.effect("inspectDrift refuses for the same reason, before a prompt could be shown", () =>
		withRoot({ "decisions/a.md": doc("A", generated) }, (root) =>
			Effect.gen(function* () {
				const flipped = yield* Effect.flip(
					inspectDrift({
						id: "decisions/a",
						bundleRoot: root,
						config,
						now: DateTime.makeUnsafe("2026-09-16T11:59:59Z"),
					}).pipe(Effect.provide(platform)),
				);
				assert.strictEqual(flipped._tag, "VerifyNotCurrentError");
				const ok = yield* inspectDrift({
					id: "decisions/a",
					bundleRoot: root,
					config,
					now: DateTime.makeUnsafe(GENERATED),
				}).pipe(Effect.provide(platform));
				assert.strictEqual(ok.id, "decisions/a");
			}),
		),
	);

	it.effect(
		"inspectDrift: a backdated --at with the clock after generated.at has no kind; a clock before it does",
		() =>
			withRoot({ "decisions/a.md": doc("A", generated) }, (root) =>
				Effect.gen(function* () {
					const inspect = (clock: string | undefined) =>
						Effect.flip(
							inspectDrift({
								id: "decisions/a",
								bundleRoot: root,
								config,
								now: DateTime.makeUnsafe("2026-09-16T11:59:59Z"),
								...(clock === undefined ? {} : { clock: DateTime.makeUnsafe(clock) }),
							}).pipe(Effect.provide(platform)),
						);
					const backdated = yield* inspect("2026-09-17T00:00:00Z");
					assert.strictEqual(backdated._tag, "VerifyNotCurrentError");
					assert.strictEqual((backdated as VerifyNotCurrentError).kind, undefined);
					assert.include(backdated.message, "omit --at to verify now");
					const ahead = yield* inspect("2026-09-16T11:00:00Z");
					assert.strictEqual((ahead as VerifyNotCurrentError).kind, "future");
					assert.strictEqual(((yield* inspect(undefined)) as VerifyNotCurrentError).kind, undefined);
				}),
			),
	);

	it.effect(
		"a concept that is both an unknown status and not current fails the status refusal first (prepareVerify order)",
		() =>
			withRoot({ "decisions/a.md": doc("A", `status: bogus\n${generated}`) }, (root) =>
				Effect.gen(function* () {
					const early = base(root, "2026-09-16T11:59:59Z");
					const both = yield* Effect.flip(runVerify({ ...early, id: "decisions/a" }).pipe(Effect.provide(platform)));
					assert.strictEqual(both._tag, "VerifyStatusUnknownError");
					const inspected = yield* Effect.flip(
						inspectDrift({ id: "decisions/a", bundleRoot: root, config, now: early.at }).pipe(Effect.provide(platform)),
					);
					assert.strictEqual(inspected._tag, "VerifyStatusUnknownError");
					// controls: --stable removes the status refusal, so the not-current one surfaces; at generated.at it writes
					const stableEarly = yield* Effect.flip(
						runVerify({ ...early, id: "decisions/a", status: "stable" }).pipe(Effect.provide(platform)),
					);
					assert.strictEqual(stableEarly._tag, "VerifyNotCurrentError");
					const ok = yield* runVerify({ ...base(root, GENERATED), id: "decisions/a", status: "stable" }).pipe(
						Effect.provide(platform),
					);
					assert.strictEqual(ok.at, GENERATED);
				}),
			),
	);

	it.effect(
		"a date-only generated.at is the start of that day in UTC: an at at that instant succeeds, one second before refuses",
		() =>
			withRoot({ "decisions/a.md": doc("A", "generated:\n  by: process:sync\n  at: 2026-09-16\n") }, (root) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(
						runVerify({ ...base(root, "2026-09-15T23:59:59Z"), id: "decisions/a" }).pipe(Effect.provide(platform)),
					);
					assert.strictEqual(error._tag, "VerifyNotCurrentError");
					assert.strictEqual((error as VerifyNotCurrentError).generatedAt, "2026-09-16T00:00:00Z");
					const ok = yield* runVerify({ ...base(root, "2026-09-16T00:00:00Z"), id: "decisions/a" }).pipe(
						Effect.provide(platform),
					);
					assert.strictEqual(ok.at, "2026-09-16T00:00:00Z");
				}),
			),
	);

	it.effect("loadPickerCandidates leaves out a row whose generated.at is later than at, and names it (#470)", () =>
		withRoot(
			{
				"decisions/f.md": doc("F", ""),
				"decisions/l.md": doc("L", "generated:\n  by: process:sync\n  at: 2026-09-10T00:00:00Z\n"),
			},
			(root) =>
				Effect.gen(function* () {
					const args = { bundleRoot: root, projectRoot: root, config };
					const before = yield* loadPickerCandidates({ ...args, at: DateTime.makeUnsafe("2026-09-09T00:00:00Z") }).pipe(
						Effect.provide(platform),
					);
					assert.deepStrictEqual(
						before.candidates.map((row) => row.id),
						["decisions/f"],
					);
					assert.deepStrictEqual(before.leftOut, ["decisions/l"]);
					// control: at after the stamp keeps the row, so the omission was the not-current rule
					const after = yield* loadPickerCandidates({ ...args, at: DateTime.makeUnsafe("2026-09-11T00:00:00Z") }).pipe(
						Effect.provide(platform),
					);
					assert.deepStrictEqual(
						after.candidates.map((row) => row.id),
						["decisions/f", "decisions/l"],
					);
					assert.deepStrictEqual(after.leftOut, []);
					// at omitted: the loader's clock decides, and a stamp before it is verifiable
					yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-09-20T00:00:00Z")));
					const omitted = yield* loadPickerCandidates(args).pipe(Effect.provide(platform));
					assert.deepStrictEqual(omitted.leftOut, []);
					assert.strictEqual(omitted.candidates.length, 2);
				}),
		),
	);

	it.effect("loadStaleCandidates leaves out a not-current row and names it in leftOut (#470)", () =>
		withRoot(
			{
				"decisions/s.md": doc(
					"S",
					'stale_after: "2026-01-01T00:00:00Z"\ngenerated:\n  by: process:sync\n  at: 2026-09-16T12:00:00Z\n',
				),
			},
			(root) =>
				Effect.gen(function* () {
					const args = {
						bundleRoot: root,
						projectRoot: root,
						config,
						now: DateTime.makeUnsafe("2026-10-01T00:00:00Z"),
					};
					const kept = yield* loadStaleCandidates(args).pipe(Effect.provide(platform));
					assert.deepStrictEqual(
						kept.candidates.map((row) => row.id),
						["decisions/s"],
					);
					assert.deepStrictEqual(kept.leftOut, []);
					const backdated = yield* loadStaleCandidates({
						...args,
						at: DateTime.makeUnsafe("2026-09-01T00:00:00Z"),
					}).pipe(Effect.provide(platform));
					assert.deepStrictEqual(backdated.candidates, []);
					assert.deepStrictEqual(backdated.leftOut, ["decisions/s"]);
					const after = yield* loadStaleCandidates({ ...args, at: DateTime.makeUnsafe("2026-09-20T00:00:00Z") }).pipe(
						Effect.provide(platform),
					);
					assert.deepStrictEqual(after.leftOut, []);
					assert.strictEqual(after.candidates.length, 1);
				}),
		),
	);
});
