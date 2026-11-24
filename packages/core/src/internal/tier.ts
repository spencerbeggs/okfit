import { Actor } from "../Actor.js";

/** The trust tier of a list of verification events (OKF 0.3 §5.3, §7): none is unverified, any `human:` is human-reviewed, else machine-confirmed. */
export const tierOf = (
	events: ReadonlyArray<{ readonly by: Actor }>,
): "unverified" | "machine-confirmed" | "human-reviewed" =>
	events.length === 0
		? "unverified"
		: events.some((entry) => Actor.isHuman(entry.by))
			? "human-reviewed"
			: "machine-confirmed";
