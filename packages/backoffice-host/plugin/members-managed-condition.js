/**
 * `Crombolo.Condition.Member.NotManaged`: the member open in the workspace is the site's
 * own, so Save is offered (story 445). A new member is always the site's own.
 */
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry'
import { UMB_MEMBER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/member'
import { managerOf } from './members-managed.js'

export class CromboloMemberNotManagedCondition extends UmbConditionBase {
  #key

  constructor(host, args) {
    super(host, args)
    this.permitted = true
    this.consumeContext(UMB_MEMBER_WORKSPACE_CONTEXT, (context) => {
      this.observe(context?.unique, async (unique) => {
        this.#key = unique
        if (!unique || context?.getIsNew?.()) {
          this.permitted = true
          return
        }
        const managedBy = await managerOf(unique)
        if (unique === this.#key) this.permitted = !managedBy
      })
    })
  }
}

export { CromboloMemberNotManagedCondition as api }
