import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { pathToUri, uriToPath } from "../../src/convert/uri.js";

describe("uri", () => {
	it("round-trips an absolute path with a space", () => {
		const path = "/tmp/okfit lsp/okf/a.md";
		const uri = pathToUri(path);
		assert.strictEqual(uri, "file:///tmp/okfit%20lsp/okf/a.md");
		assert.deepStrictEqual(uriToPath(uri), Option.some(path));
	});
	it("returns None for a non-file URI", () => {
		assert.isTrue(Option.isNone(uriToPath("untitled:Untitled-1")));
		assert.isTrue(Option.isNone(uriToPath("https://example.com/a.md")));
	});
	it("returns None for a malformed file URI rather than throwing", () => {
		assert.isTrue(Option.isNone(uriToPath("file:%")));
	});
});
