import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { BundleLoadOptions } from "../src/Bundle.js";
import { Bundle, BundleDepthExceededError, BundleReadError, BundleRootNotFoundError } from "../src/Bundle.js";
import type { ConceptId } from "../src/ConceptId.js";
import type { Diagnostic } from "../src/Diagnostic.js";
import { MOUNT, badBundlePlatform, faultyPlatform, platform } from "./utils/bundles.js";

const load = (name: string, options: Omit<BundleLoadOptions, "root"> = {}) =>
	Bundle.load({ root: MOUNT, ...options }).pipe(Effect.provide(badBundlePlatform(name)));
const codes = (diagnostics: ReadonlyArray<Diagnostic>) => diagnostics.map((d) => [d.file, d.code, d.range?.line]);
const id = (value: string) => value as ConceptId;

describe("Bundle.load", () => {
	it.effect("fails typed when the root is missing or a file (D-9)", () =>
		Effect.gen(function* () {
			const missing = yield* Effect.flip(Bundle.load({ root: "/nowhere" }));
			assert.instanceOf(missing, BundleRootNotFoundError);
			assert.strictEqual(missing.root, "/nowhere");
			assert.instanceOf(yield* Effect.flip(Bundle.load({ root: `${MOUNT}/visible.md` })), BundleRootNotFoundError);
		}).pipe(Effect.provide(badBundlePlatform("c-hidden-directory"))),
	);
	it.effect("unreadable root and unreadable file are BundleReadError; unreadable subdirectory is a warning", () =>
		Effect.gen(function* () {
			const root = yield* Effect.flip(
				Bundle.load({ root: MOUNT }).pipe(Effect.provide(faultyPlatform({ [`${MOUNT}/a.md`]: "" }, new Set([MOUNT])))),
			);
			assert.instanceOf(root, BundleReadError);
			assert.strictEqual(root.path, "");
			const file = yield* Effect.flip(
				Bundle.load({ root: MOUNT }).pipe(
					Effect.provide(faultyPlatform({ [`${MOUNT}/gone.md`]: "" }, new Set(), new Set([`${MOUNT}/gone.md`]))),
				),
			);
			assert.instanceOf(file, BundleReadError);
			assert.strictEqual(file.path, "gone.md");
			const bundle = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(faultyPlatform({ [`${MOUNT}/locked/a.md`]: "" }, new Set([`${MOUNT}/locked`]))),
			);
			assert.deepStrictEqual(codes(bundle.diagnostics), [["locked", "walk-unreadable", undefined]]);
			assert.strictEqual(bundle.diagnostics[0]?.severity, "warning");
		}),
	);
	it.effect("frontmatter-missing on a concept; index.md without a fence is normal (D-13)", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-frontmatter-missing");
			assert.deepStrictEqual(codes(bundle.diagnostics), [["no-front.md", "frontmatter-missing", undefined]]);
			assert.strictEqual(bundle.concepts.size, 0);
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.entries[0]?.target, "no-front.md");
			assert.deepStrictEqual(bundle.files, ["index.md", "no-front.md"]);
		}),
	);
	it.effect("frontmatter-unclosed points at the fence; unparseable YAML maps into file coordinates (D-14)", () =>
		Effect.gen(function* () {
			const unclosed = yield* load("c-frontmatter-unclosed");
			assert.deepStrictEqual(codes(unclosed.diagnostics), [["unclosed.md", "frontmatter-unclosed", 0]]);
			assert.strictEqual(unclosed.diagnostics[0]?.range?.length, 3);
			const dup = yield* load("c-duplicate-key");
			assert.deepStrictEqual(codes(dup.diagnostics), [["dup.md", "frontmatter-unparseable", 3]]);
			assert.strictEqual(unclosed.concepts.size + dup.concepts.size, 0);
		}),
	);
	it.effect("type-missing flows through from the stage-1 decoder (D-15)", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-type-missing");
			assert.deepStrictEqual(
				bundle.diagnostics.map((d) => d.code),
				["type-missing"],
			);
			assert.strictEqual(bundle.concepts.size, 0);
		}),
	);
	it.effect(
		"root okf_version accepted, non-root index frontmatter rejected; concept and computation body load (D-20, D-21)",
		() =>
			Effect.gen(function* () {
				const bundle = yield* load("c-index-frontmatter");
				assert.deepStrictEqual(codes(bundle.diagnostics), [["sub/index.md", "index-frontmatter", 0]]);
				assert.strictEqual(bundle.indexes.get("")?.okfVersion, "0.2");
				assert.strictEqual(bundle.indexes.get("sub")?.sections[0]?.heading, "Sub");
				const thing = bundle.concepts.get(id("sub/thing"));
				assert.strictEqual(thing?.path, "sub/thing.md");
				assert.strictEqual(thing?.frontmatter.type, "Note");
				assert.deepStrictEqual(
					Option.map(thing?.computationBody ?? Option.none(), (body) => body.trim()),
					Option.some("SELECT 1"),
				);
				assert.deepStrictEqual(bundle.directories, ["sub"]);
			}),
	);
	it.effect("log-heading-invalid comes from the reserved parser; log.md is never a concept (D-12)", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-log-heading-invalid");
			assert.deepStrictEqual(codes(bundle.diagnostics), [["log.md", "log-heading-invalid", 6]]);
			assert.deepStrictEqual([...bundle.concepts.keys()], ["note"]);
			assert.strictEqual(bundle.logs.get("")?.groups.length, 1);
		}),
	);
	it.effect("index entries before any section heading are index-malformed; the heading's own entry still parses", () =>
		Effect.gen(function* () {
			const bundle = yield* load("c-index-entries-before-heading");
			assert.deepStrictEqual(codes(bundle.diagnostics), [["index.md", "index-malformed", 0]]);
			assert.strictEqual(bundle.diagnostics[0]?.message, "index entries appear before any section heading");
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.heading, "Widgets");
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.entries.length, 1);
			assert.strictEqual(bundle.indexes.get("")?.sections[0]?.entries[0]?.target, "widget.md");
		}),
	);
	it.effect("a bundle deeper than maxDepth fails with BundleDepthExceededError (W-1)", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				Bundle.load({ root: MOUNT, maxDepth: 1 }).pipe(Effect.provide(platform({ [`${MOUNT}/a/b/c.md`]: "" }))),
			);
			assert.instanceOf(error, BundleDepthExceededError);
			assert.strictEqual(error.path, "a");
			assert.strictEqual(error.limit, 1);
		}),
	);
	it.effect("hidden entries are excluded unless includeHidden (D-11)", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual([...(yield* load("c-hidden-directory")).concepts.keys()], ["visible"]);
			assert.deepStrictEqual(
				[...(yield* load("c-hidden-directory", { includeHidden: true })).concepts.keys()],
				[".drafts/secret", ".hidden", "visible"],
			);
		}),
	);
});
