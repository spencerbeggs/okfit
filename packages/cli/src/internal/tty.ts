/**
 * K-19: exactly the framework's own colour rule. Evaluated once per run at
 * the command boundary and passed to the renderers as a boolean, so every
 * renderer stays pure. The only reader of `process.stdout.isTTY`/`NO_COLOR`
 * in this package.
 *
 * @public
 */
export const useColor = (): boolean => process.stdout.isTTY === true && process.env.NO_COLOR !== "1";
