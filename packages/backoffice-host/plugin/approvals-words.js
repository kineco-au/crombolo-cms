/** What the Approvals section says (story 028). Pure. */

/**
 * How many changes wait for approval: "You have 3 changes waiting for approval".
 * @param {number} count
 * @returns {string}
 */
export function waitingLine(count) {
  if (count === 0) return 'You have no changes waiting for approval.'
  return `You have ${count} ${count === 1 ? 'change' : 'changes'} waiting for approval.`
}
