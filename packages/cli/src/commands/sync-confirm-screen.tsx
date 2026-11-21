import { Fmt } from "@effected/cli-kit";
import type { ConfirmResult, Screen } from "@effected/cli-kit/ui";
import { Confirm } from "@effected/cli-kit/ui";
import { Box, Static, Text } from "ink";
import type { ReactElement } from "react";

/** What the sync confirm screen draws: the plan's lines, then the question. */
export interface PlanConfirmOptions {
	readonly lines: ReadonlyArray<string>;
	readonly message: string;
}

/**
 * The plan and the question on one screen. The plan is Ink `Static` output:
 * written once above the live frame and never redrawn, so a long plan never
 * hits the frame-height limit and reaches the terminal only once the screen has
 * mounted. Each line is sanitized, since it carries concept data.
 */
export const PlanConfirmScreen = (
	props: PlanConfirmOptions & { readonly onSubmit: (result: ConfirmResult<never>) => void },
): ReactElement => (
	<Box flexDirection="column">
		<Static items={[...props.lines]}>{(line, index) => <Text key={index}>{Fmt.sanitize(line)}</Text>}</Static>
		<Confirm.View message={props.message} initial={true} onSubmit={props.onSubmit} />
	</Box>
);

/**
 * The plan-and-confirm screen for `CliUi.run`. Load this module through
 * `CliUi.lazy` so React and Ink load only when the screen mounts.
 */
export const planConfirmScreen =
	(options: PlanConfirmOptions): Screen<ConfirmResult<never>> =>
	(control) => <PlanConfirmScreen {...options} onSubmit={control.resolve} />;
