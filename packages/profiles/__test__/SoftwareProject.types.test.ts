import { assert, describe, it } from "@effect/vitest";
import { softwareProject } from "../src/SoftwareProject.js";

describe("software-project docs types", () => {
	it("declares Surface with kind and audience enums", () => {
		const surface = softwareProject.config.types?.Surface;
		assert.deepStrictEqual(surface?.required, ["kind", "audience", "resource"]);
		assert.deepStrictEqual(Object.keys(surface?.fields?.kind?.values ?? {}), ["site", "repo", "readme"]);
		assert.deepStrictEqual(Object.keys(surface?.fields?.audience?.values ?? {}), ["users", "contributors", "agents"]);
		assert.strictEqual(surface?.fields?.links_to?.kind, "path");
		assert.strictEqual(surface?.fields?.url?.kind, undefined);
	});
	it("declares Publication requiring resource, surface, renders", () => {
		const publication = softwareProject.config.types?.Publication;
		assert.deepStrictEqual(publication?.required, ["resource", "surface", "renders"]);
		assert.strictEqual(publication?.fields?.surface?.kind, "path");
	});
	it("lays out surfaces/ and publications/", () => {
		const dirs = softwareProject.layout.directories.map((d) => `${d.directory}:${d.type}`);
		assert.include(dirs, "surfaces:Surface");
		assert.include(dirs, "publications:Publication");
	});
});
