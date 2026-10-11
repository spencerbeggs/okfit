import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { ActorPattern, ConceptId } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import { DateTime, Effect, Layer } from "effect";
import { locateIntegrity, removeIntegrityVerified } from "../../src/verify/integrity.js";
import { locateVerifiedEntries } from "../../src/verify/revoke.js";
import { runRevoke } from "../../src/verify/run.js";
import { DIGEST, bindFixtures } from "../utils/binding.js";
import { identityConfigGet } from "../utils/gitIdentity.js";

const head = "---\ntype: Decision\ntitle: T\n";
const ada = "  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n";
const bob = "  - by: human:bob\n    at: 2026-09-02T00:00:00Z\n";
const cy = "  - by: human:cy\n    at: 2026-09-03T00:00:00Z\n";
const tail = "---\n\n# T\n";

/** The slices of `source` the located removals cover. */
const cuts = (source: string, removals: ReadonlyArray<{ start: number; end: number }>) =>
	removals.map((span) => source.slice(span.start, span.end));

describe("locateVerifiedEntries", () => {
	it.effect("a single entry by the actor removes the key and its block", () =>
		Effect.gen(function* () {
			const source = `${head}verified:\n${ada}status: stable\n${tail}`;
			const located = yield* locateVerifiedEntries(source, "human:ada");
			assert.strictEqual(located._tag, "entries");
			if (located._tag !== "entries") return;
			assert.isTrue(located.removesAll);
			assert.deepStrictEqual(cuts(source, located.removals), [`verified:\n${ada}`]);
			assert.strictEqual(source.slice(located.keyLine.start, located.keyLine.end), "verified:\n");
		}),
	);

	it.effect("a middle entry of three is cut as its own whole lines", () =>
		Effect.gen(function* () {
			const source = `${head}verified:\n${ada}${bob}${cy}${tail}`;
			const located = yield* locateVerifiedEntries(source, "human:bob");
			assert.strictEqual(located._tag, "entries");
			if (located._tag !== "entries") return;
			assert.isFalse(located.removesAll);
			assert.deepStrictEqual(cuts(source, located.removals), [bob]);
		}),
	);

	it.effect("the last entry is cut with its terminator, leaving the earlier ones", () =>
		Effect.gen(function* () {
			const source = `${head}verified:\n${ada}${bob}${tail}`;
			const located = yield* locateVerifiedEntries(source, "human:bob");
			assert.strictEqual(located._tag, "entries");
			if (located._tag !== "entries") return;
			assert.deepStrictEqual(cuts(source, located.removals), [bob]);
		}),
	);

	it.effect("every entry by the actor in a list of several is removed", () =>
		Effect.gen(function* () {
			const source = `${head}verified:\n${ada}${bob}  - by: human:ada\n    at: 2026-09-04T00:00:00Z\n${tail}`;
			const located = yield* locateVerifiedEntries(source, "human:ada");
			assert.strictEqual(located._tag, "entries");
			if (located._tag !== "entries") return;
			assert.isFalse(located.removesAll);
			assert.deepStrictEqual(cuts(source, located.removals), [
				ada,
				"  - by: human:ada\n    at: 2026-09-04T00:00:00Z\n",
			]);
		}),
	);

	it.effect("a bare mapping by the actor removes the whole key", () =>
		Effect.gen(function* () {
			const source = `${head}verified:\n  by: human:ada\n  at: 2026-09-01T00:00:00Z\nstatus: stable\n${tail}`;
			const located = yield* locateVerifiedEntries(source, "human:ada");
			assert.strictEqual(located._tag, "entries");
			if (located._tag !== "entries") return;
			assert.isTrue(located.removesAll);
			assert.deepStrictEqual(cuts(source, located.removals), [
				"verified:\n  by: human:ada\n  at: 2026-09-01T00:00:00Z\n",
			]);
		}),
	);

	it.effect("an actor with no entry, or no verified key at all, is none", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* locateVerifiedEntries(`${head}verified:\n${bob}${tail}`, "human:ada"))._tag, "none");
			assert.strictEqual((yield* locateVerifiedEntries(`${head}${tail}`, "human:ada"))._tag, "none");
		}),
	);

	it.effect("a flow sequence and an alias are unsupported", () =>
		Effect.gen(function* () {
			const flow = yield* locateVerifiedEntries(
				`${head}verified: [{ by: human:ada, at: 2026-09-01T00:00:00Z }]\n${tail}`,
				"human:ada",
			);
			assert.deepStrictEqual(flow, { _tag: "unsupported", shape: "flow-sequence" });
			const alias = yield* locateVerifiedEntries(
				`${head}base: &v\n  - by: human:ada\nverified: *v\n${tail}`,
				"human:ada",
			);
			assert.deepStrictEqual(alias, { _tag: "unsupported", shape: "alias" });
		}),
	);
});

describe("removeIntegrityVerified", () => {
	const removal = (source: string) =>
		Effect.gen(function* () {
			const located = yield* locateIntegrity(source);
			if (located._tag === "unsupported") return yield* Effect.die(new Error("unsupported"));
			return removeIntegrityVerified(located, source);
		});
	const apply = (source: string, edit: { offset: number; length: number; content: string }) =>
		source.slice(0, edit.offset) + edit.content + source.slice(edit.offset + edit.length);

	it.effect("keeps the generated slot, comments and quoting byte-identical", () =>
		Effect.gen(function* () {
			const generated = "  generated:\n    # stamped\n    body: '0123456789012345'\n";
			const source = `${head}integrity:\n${generated}  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: abcdef0123456789\n${tail}`;
			const out = yield* removal(source);
			assert.strictEqual(out._tag, "edit");
			if (out._tag !== "edit") return;
			assert.strictEqual(apply(source, out.edit), `${head}integrity:\n${generated}${tail}`);
		}),
	);

	it.effect("deletes the whole block when generated is absent too", () =>
		Effect.gen(function* () {
			const source = `${head}integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: abcdef0123456789\n${tail}`;
			const out = yield* removal(source);
			assert.strictEqual(out._tag, "edit");
			if (out._tag !== "edit") return;
			assert.strictEqual(apply(source, out.edit), `${head}${tail}`);
		}),
	);

	it.effect("keeps an unknown key and its block, removing only verified", () =>
		Effect.gen(function* () {
			const source = `${head}integrity:\n  note: keep\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: abcdef0123456789\n${tail}`;
			const out = yield* removal(source);
			assert.strictEqual(out._tag, "edit");
			if (out._tag !== "edit") return;
			assert.strictEqual(apply(source, out.edit), `${head}integrity:\n  note: keep\n${tail}`);
		}),
	);

	it.effect("removes a quoted verified key", () =>
		Effect.gen(function* () {
			const generated = "  generated:\n    body: abcdef0123456789\n";
			const source = `${head}integrity:\n${generated}  'verified':\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: abcdef0123456789\n${tail}`;
			const out = yield* removal(source);
			if (out._tag !== "edit") return assert.fail(`expected edit, got ${out._tag}`);
			assert.strictEqual(apply(source, out.edit), `${head}integrity:\n${generated}${tail}`);
		}),
	);

	it.effect("fails closed when there is no verified line to cut", () =>
		Effect.gen(function* () {
			const source = `${head}integrity:\n  generated:\n    body: abcdef0123456789\n${tail}`;
			assert.strictEqual((yield* removal(source))._tag, "unsupported");
		}),
	);
});

describe("runRevoke", () => {
	const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: {} },
		actors: { humans: ["human:ada" as ActorPattern] },
		extensions: {},
	});
	const gitFake = Layer.succeed(Git, {
		configGet: identityConfigGet,
	} as unknown as Git["Service"]);
	const platform = Layer.mergeAll(gitFake, NodeServices.layer);

	const withConcept = <A, E, R>(source: string, use: (root: string, file: string) => Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-revoke-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const file = join(root, "decisions", "a.md");
				yield* Effect.promise(() => writeFile(file, source));
				yield* bindFixtures(root, ["decisions/a.md"]).pipe(Effect.provide(NodeServices.layer));
				return yield* use(root, file);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		});

	const revoke = (root: string, dryRun = false) =>
		runRevoke({ id: "decisions/a", bundleRoot: root, projectRoot: root, config, dryRun }).pipe(
			Effect.provide(platform),
		);

	const signalOf = (root: string) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root });
			const concept = bundle.concepts.get("decisions/a" as ConceptId);
			if (concept === undefined) return yield* Effect.die(new Error("missing concept"));
			return yield* Trust.signal(concept, OkfitConfig.DEFAULTS, AT);
		}).pipe(Effect.provide(NodeServices.layer));

	const binding = (by: string, at: string) =>
		`integrity:\n  verified:\n    by: ${by}\n    at: ${at}\n    content: ${DIGEST}\n`;

	it.effect("removes the actor's entries and clears the binding; another actor's entry then reads unbound", () =>
		withConcept(`${head}verified:\n${bob}${ada}${binding("human:ada", "2026-09-01T00:00:00Z")}${tail}`, (root, file) =>
			Effect.gen(function* () {
				const result = yield* revoke(root);
				assert.deepStrictEqual(result.removed, ["2026-09-01T00:00:00Z"]);
				assert.isTrue(result.bindingCleared);
				assert.strictEqual(result.by, "human:ada");
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), `${head}verified:\n${bob}${tail}`);
				const signal = yield* signalOf(root);
				assert.strictEqual(signal.integrity, "drifted");
				assert.strictEqual(signal.drift?.reason, "unbound");
			}),
		),
	);

	it.effect("leaves a binding to another actor alone: stale at is entry-superseded", () =>
		withConcept(`${head}verified:\n${bob}${ada}${binding("human:bob", "2026-08-01T00:00:00Z")}${tail}`, (root, file) =>
			Effect.gen(function* () {
				const result = yield* revoke(root);
				assert.isFalse(result.bindingCleared);
				const after = yield* Effect.promise(() => readFile(file, "utf8"));
				assert.ok(
					after.includes("integrity:\n  verified:\n    by: human:bob\n    at: 2026-08-01T00:00:00Z\n    content: "),
				);
				assert.ok(!after.includes("human:ada"));
				const signal = yield* signalOf(root);
				assert.strictEqual(signal.drift?.reason, "entry-superseded");
			}),
		),
	);

	it.effect("leaves a binding that matches the remaining entry current", () =>
		withConcept(`${head}verified:\n${bob}${ada}${binding("human:bob", "2026-09-02T00:00:00Z")}${tail}`, (root) =>
			Effect.gen(function* () {
				const result = yield* revoke(root);
				assert.isFalse(result.bindingCleared);
				assert.strictEqual((yield* signalOf(root)).integrity, "current");
			}),
		),
	);

	it.effect("keeps integrity.generated when it clears the binding", () => {
		const generated = "integrity:\n  generated:\n    body: 0123456789abcdef\n";
		return withConcept(
			`${head}verified:\n${ada}${generated}  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n${tail}`,
			(root, file) =>
				Effect.gen(function* () {
					yield* revoke(root);
					assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), `${head}${generated}${tail}`);
				}),
		);
	});

	it.effect("clears the actor's binding even when the integrity block does not decode as a whole", () => {
		const source = `${head}verified:\n${ada}integrity:\n  generated: nope\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n${tail}`;
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				const result = yield* revoke(root);
				assert.isTrue(result.bindingCleared);
				assert.strictEqual(
					yield* Effect.promise(() => readFile(file, "utf8")),
					`${head}integrity:\n  generated: nope\n${tail}`,
				);
			}),
		);
	});

	it.effect("a dry run reports the same result and writes nothing", () => {
		const source = `${head}verified:\n${ada}${binding("human:ada", "2026-09-01T00:00:00Z")}${tail}`;
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				const before = yield* Effect.promise(() => readFile(file, "utf8"));
				const result = yield* revoke(root, true);
				assert.isTrue(result.dryRun);
				assert.isTrue(result.bindingCleared);
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), before);
			}),
		);
	});

	it.effect("an actor with no entry fails VerifyNothingToRevokeError and writes nothing", () => {
		const source = `${head}verified:\n${bob}${tail}`;
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				const error = yield* revoke(root).pipe(Effect.flip);
				assert.strictEqual(error._tag, "VerifyNothingToRevokeError");
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), source);
			}),
		);
	});

	it.effect("a flow-sequence verified fails closed, file untouched", () => {
		const source = `${head}verified: [{ by: human:ada, at: 2026-09-01T00:00:00Z }]\n${tail}`;
		return withConcept(source, (root, file) =>
			Effect.gen(function* () {
				const error = yield* revoke(root).pipe(Effect.flip);
				assert.strictEqual(error._tag, "VerifyUnsupportedFrontmatterError");
				assert.strictEqual(yield* Effect.promise(() => readFile(file, "utf8")), source);
			}),
		);
	});
});
