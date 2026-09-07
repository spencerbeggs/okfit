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

export const SCHEMA_URL = SchemaVersioning.schemaUrl(BASE_URL, CATALOG_NAME, SCHEMA_SEMVER);

/** Exported so the drift test checks exactly the wiring the generator writes. */
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
	const preflight = yield* SchemaPipeline.check(targets);
	// `contractBlocked` is the pipeline's own verdict (`change === "contract"`
	// AND a pinned version). Read the field rather than re-deriving it: the two
	// coincide only while SCHEMA_SEMVER stays a pinned release label.
	const broken = preflight.filter((r) => r.contractBlocked);
	if (broken.length > 0) {
		for (const r of broken) yield* Effect.logError(`Contract change in an already-published schema: ${r.path}`);
		return yield* Effect.fail(
			new Error(
				`${broken.length} document(s) changed their contract at version ${SCHEMA_SEMVER}. Nothing was written. ` +
					"Bump SCHEMA_SEMVER in lib/scripts/generate-schema.ts to the new label, then re-run.",
			),
		);
	}
	const results = yield* SchemaPipeline.run(targets);
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
