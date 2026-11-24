import { assert, describe, it } from "@effect/vitest";
import { ProfileKeys } from "../src/ProfileKeys.js";
import { softwareProject } from "../src/SoftwareProject.js";

describe("software-project docs types", () => {
	it("declares Surface with kind and audience enums", () => {
		const surface = softwareProject.config.types?.Surface;
		assert.deepStrictEqual(surface?.required, [ProfileKeys.kind, ProfileKeys.audience, "resource"]);
		assert.deepStrictEqual(Object.keys(surface?.fields?.[ProfileKeys.kind]?.values ?? {}), ["site", "repo", "readme"]);
		assert.deepStrictEqual(Object.keys(surface?.fields?.[ProfileKeys.audience]?.values ?? {}), [
			"users",
			"contributors",
			"agents",
		]);
		assert.strictEqual(surface?.fields?.[ProfileKeys.links_to]?.kind, "path");
		assert.strictEqual(surface?.fields?.[ProfileKeys.url]?.kind, undefined);
	});
	it("declares Publication requiring resource, surface, renders", () => {
		const publication = softwareProject.config.types?.Publication;
		assert.deepStrictEqual(publication?.required, ["resource", ProfileKeys.surface, ProfileKeys.renders]);
		assert.strictEqual(publication?.fields?.[ProfileKeys.surface]?.kind, "path");
	});
	it("lays out surfaces/ and publications/", () => {
		const dirs = softwareProject.layout.directories.map((d) => `${d.directory}:${d.type}`);
		assert.include(dirs, "surfaces:Surface");
		assert.include(dirs, "publications:Publication");
	});
});
