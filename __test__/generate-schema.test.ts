/**
 * Guards schemas/config/okfit-1.0.0.json against drift from OkfitConfig.
 * If this fails, run `pnpm generate-schema` and commit the regenerated file.
 */
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { CatalogEntry, DocumentDiff, SchemaFile, SchemaPipeline, SchemaValidator } from "@effected/schemastore";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { catalogEntry, targets } from "../lib/scripts/generate-schema.js";

const TestLayer = Layer.mergeAll(SchemaFile.layer, SchemaValidator.layer).pipe(Layer.provide(NodeServices.layer));

describe("generated okfit config JSON Schema", () => {
	for (const target of targets) {
		it(`${basename(target.path)} matches its Effect Schema source`, async () => {
			const result = await Effect.runPromise(SchemaPipeline.checkOne(target).pipe(Effect.provide(TestLayer)));
			expect(result.blocked, `gate blocked: ${result.findings.map((f) => f.label).join(", ")}`).toBe(false);
			expect(DocumentDiff.isClean(result.change), `expected no drift, got "${result.change}"`).toBe(true);
		});
	}
});

describe("generated SchemaStore catalog entry", () => {
	it("matches a fresh CatalogEntry.assemble call", () => {
		const onDisk = JSON.parse(
			readFileSync(resolve(import.meta.dirname, "..", "schemas", "config", "catalog-entry.json"), "utf8"),
		);
		expect(onDisk).toEqual(Schema.encodeSync(CatalogEntry)(catalogEntry));
	});

	it("passes CatalogEntry.lintFileMatch with no findings", () => {
		expect(CatalogEntry.lintFileMatch(catalogEntry.fileMatch)).toEqual([]);
	});
});
