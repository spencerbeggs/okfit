import { assert, describe, it } from "@effect/vitest";
import { useColor } from "../../src/internal/tty.js";

describe("useColor", () => {
	it('is true only when stdout is a TTY and NO_COLOR is not "1" (K-19)', () => {
		const originalIsTTY = process.stdout.isTTY;
		const originalNoColor = process.env.NO_COLOR;
		try {
			Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
			delete process.env.NO_COLOR;
			assert.isTrue(useColor());

			process.env.NO_COLOR = "1";
			assert.isFalse(useColor());

			delete process.env.NO_COLOR;
			Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
			assert.isFalse(useColor());
		} finally {
			Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
			if (originalNoColor === undefined) delete process.env.NO_COLOR;
			else process.env.NO_COLOR = originalNoColor;
		}
	});
});
