/**
 * Generates schemas/config/okfit-1.0.0.json from `okfitConfigDocumentFields`
 * and schemas/config/catalog-entry.json from the same version pin.
 * Run via `pnpm generate-schema`; drift-guarded by __test__/generate-schema.test.ts.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeServices } from "@effect/platform-node";
import {
	CanonicalJson,
	CatalogEntry,
	SchemaFile,
	SchemaPipeline,
	SchemaTarget,
	SchemaValidator,
	SchemaVersioning,
} from "@effected/schemastore";
import { okfitConfigDocumentFields } from "@okfit/core";
import { Effect, FileSystem, Layer, Result, Schema } from "effect";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CATALOG_NAME = "okfit";
const BASE_URL = "https://raw.githubusercontent.com/spencerbeggs/okfit/main/schemas/config";

/** Bumping this is the response to a `contract` change (C-18), not a workaround for one. */
const SCHEMA_SEMVER = SchemaVersioning.parseResult("1.0.0").pipe(
	Result.getOrThrowWith((e) => new Error(`SCHEMA_SEMVER is not a valid schema version: ${e.message}`)),
);

/**
 * Whether this schema has been submitted to and accepted by the SchemaStore
 * catalog. `SCHEMA_SEMVER` above is not yet a published label anyone else
 * depends on, so while this is `false` a `contract`-class change rewrites it
 * in place (C-18) instead of being refused by `SchemaPipeline`'s
 * `"block-versioned"` default — passed here as `contractChanges: "allow"`.
 * Flip this to `true` the same day the catalog entry merges upstream; every
 * `contract` change after that must bump `SCHEMA_SEMVER` instead, and this
 * flag is what makes the pipeline start enforcing that.
 */
const CATALOGUED = false;

const PIPELINE_OPTIONS = { contractChanges: CATALOGUED ? ("block-versioned" as const) : ("allow" as const) };

export const SCHEMA_URL = SchemaVersioning.schemaUrl(BASE_URL, CATALOG_NAME, SCHEMA_SEMVER);

/**
 * Exported so the drift test checks exactly the wiring the generator writes.
 *
 * TEMPORARY: since effect@4.0.0-rc.113 (#8147) `Schema.toJsonSchemaDocument`
 * leaves structs open by default and `@effected/schemastore` gives a target no
 * way to pass `onExcessProperty: "error"` (effected#688), so the written
 * document currently leaves every declared table open instead of closed
 * (C-16). Add `jsonSchema: { onExcessProperty: "error" }` here and regenerate
 * once schemastore ships that field.
 */
export const targets: ReadonlyArray<SchemaTarget> = [
	SchemaTarget.make({
		schema: okfitConfigDocumentFields,
		$id: SCHEMA_URL,
		name: CATALOG_NAME,
		version: SCHEMA_SEMVER,
		path: resolve(REPO_ROOT, "schemas", "config", SchemaVersioning.fileName(CATALOG_NAME, SCHEMA_SEMVER)),
	}),
];

/** C-19's three patterns, in the shape git-cliff's accepted catalog entry already uses. */
export const catalogEntry = CatalogEntry.assemble({
	name: CATALOG_NAME,
	description: "okfit config file for an Open Knowledge Format (OKF) bundle",
	fileMatch: ["okfit.toml", ".okfit.toml", "**/.config/okfit.toml"],
	baseUrl: BASE_URL,
	versions: [SCHEMA_SEMVER],
});

const CATALOG_ENTRY_PATH = resolve(REPO_ROOT, "schemas", "config", "catalog-entry.json");

const generate = Effect.gen(function* () {
	const preflight = yield* SchemaPipeline.check(targets, PIPELINE_OPTIONS);
	// `contractBlocked` is the pipeline's own verdict (`change === "contract"`
	// AND a pinned version AND `CATALOGUED`). Read the field rather than
	// re-deriving it: the two coincide only while `PIPELINE_OPTIONS` matches
	// what `run` below is given.
	const broken = preflight.filter((r) => r.contractBlocked);
	if (broken.length > 0) {
		const nextVersion = SchemaVersioning.next(SCHEMA_SEMVER, "contract");
		for (const r of broken) yield* Effect.logError(`Contract change in an already-published schema: ${r.path}`);
		return yield* Effect.fail(
			new Error(
				`${broken.length} document(s) changed their contract at version ${SCHEMA_SEMVER}. Nothing was written. ` +
					`Bump SCHEMA_SEMVER in lib/scripts/generate-schema.ts to ${nextVersion}, then re-run.`,
			),
		);
	}
	const results = yield* SchemaPipeline.run(targets, PIPELINE_OPTIONS);
	for (const result of results) {
		for (const finding of result.findings) {
			yield* Effect.logInfo(`${result.$id}: ${finding.label} at "${finding.path}" — ${finding.message}`);
		}
		yield* Effect.log(
			result.outcome === "written" ? `Written (${result.change}): ${result.path}` : `Unchanged: ${result.path}`,
		);
	}

	// The catalog entry is generated too, so `git diff --exit-code schemas/`
	// after two runs is mechanical rather than a hand-kept coincidence.
	const fs = yield* FileSystem.FileSystem;
	const encoded = Schema.encodeSync(CatalogEntry)(catalogEntry);
	const text = yield* CanonicalJson.serialize(encoded);
	const existing = (yield* fs.exists(CATALOG_ENTRY_PATH)) ? yield* fs.readFileString(CATALOG_ENTRY_PATH) : "";
	if (existing === text) {
		yield* Effect.log(`Unchanged: ${CATALOG_ENTRY_PATH}`);
	} else {
		yield* fs.writeFileString(CATALOG_ENTRY_PATH, text);
		yield* Effect.log(`Written: ${CATALOG_ENTRY_PATH}`);
	}
});

// provideMerge, NOT provide: the generator itself yields `FileSystem.FileSystem`
// to write the catalog entry, so the platform services must stay in the layer's
// OUTPUT rather than being consumed by the two schemastore layers.
const AppLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(Layer.provideMerge(NodeServices.layer));

const invokedDirectly =
	process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
	await Effect.runPromise(generate.pipe(Effect.provide(AppLayer)));
}
