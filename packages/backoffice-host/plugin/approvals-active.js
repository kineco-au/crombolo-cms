/**
 * `Crombolo.Condition.ApprovalsActive`: the Approvals section and a page's
 * Workflow tab show only while the site has a workflow or a request is open
 * (story 234). The designer calls `approvalsChanged()` after a save or a delete,
 * so the first workflow brings them in without a reload.
 */
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry'
import { approvalsActive } from './workflow-client.js'

const listeners = new Set()

/** Asks every condition to check again. */
export function approvalsChanged() {
  for (const listener of listeners) listener()
}

export class CromboloApprovalsActiveCondition extends UmbConditionBase {
  #listener = () => this.#check()

  constructor(host, args) {
    super(host, args)
    listeners.add(this.#listener)
    this.#check()
  }

  async #check() {
    const answer = await approvalsActive()
    // A failed check leaves Approvals where people can still reach their requests.
    this.permitted = answer.ok ? answer.active === true : true
  }

  destroy() {
    listeners.delete(this.#listener)
    super.destroy()
  }
}

export default CromboloApprovalsActiveCondition

export { CromboloApprovalsActiveCondition as api }
