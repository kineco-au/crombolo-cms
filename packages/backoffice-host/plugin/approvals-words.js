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

/** What Approvals says while the site has no workflow. */
export const NO_WORKFLOWS = 'You have no approval workflows'

/** The link to the designer above the list, for someone who may change workflows. */
export const EDIT_WORKFLOWS = 'Edit workflows'

/** The link to make one, for someone who may. */
export const CREATE_WORKFLOW = 'Create one here'

/** Where workflows are made: the designer, in Structure. */
export const designerHref = () => {
  const base = (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(
    /\/$/,
    '',
  )
  return `${base}/section/content/structure/workflows`
}
