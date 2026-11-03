/** Crombolo (story 253): a block's alias, a name a page's views and the command line pick it out by. */
export const UMB_BLOCK_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * What is wrong with an alias for a block, given the aliases its list's other blocks have.
 * @param {string} alias - the alias given; empty for none
 * @param {Array<string>} others - the other blocks' aliases in the same list
 * @returns {string | undefined} why it cannot be used, or undefined when it can
 */
export function umbBlockAliasProblem(alias: string, others: Array<string>): string | undefined {
	if (alias === '') return undefined;
	if (!UMB_BLOCK_ALIAS_PATTERN.test(alias)) return 'Letters, digits, - and _, starting with a letter';
	if (others.some((other) => other.toLowerCase() === alias.toLowerCase()))
		return 'Another block here has this alias';
	return undefined;
}
