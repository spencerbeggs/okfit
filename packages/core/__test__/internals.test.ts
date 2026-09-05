import { assert, describe, it } from "@effect/vitest";
import { detectFence } from "../src/internal/fence.js";

describe("internal primitives", () => {
	it("classifies closed, unclosed and absent fences (D-13)", () => {
		assert.strictEqual(detectFence("---\ntype: A\n---\n\nbody\n"), "closed");
		assert.strictEqual(detectFence("---\r\ntype: A\r\n---\r\n"), "closed");
		assert.strictEqual(detectFence("---\ntype: A\n\nbody\n"), "unclosed");
		assert.strictEqual(detectFence("---"), "unclosed");
		assert.strictEqual(detectFence("# Title\n\n---\n"), "absent");
		assert.strictEqual(detectFence("﻿---\ntype: A\n---\n"), "absent");
		assert.strictEqual(detectFence("---json\n{}\n---\n"), "absent");
	});
});
