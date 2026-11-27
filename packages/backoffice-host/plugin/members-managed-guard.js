/**
 * A member a directory keeps, read only (story 445): the workspace's read-only state,
 * with the line naming who keeps them. Registered by `members-managed.js`.
 */
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api'
import { UMB_MEMBER_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/member'
import { managerLine, managerOf } from './members-managed.js'

const READ_ONLY_RULE = 'CROMBOLO_MEMBER_MANAGED'

export class CromboloMemberManaged extends UmbControllerBase {
  #key

  constructor(host) {
    super(host)
    this.consumeContext(UMB_MEMBER_WORKSPACE_CONTEXT, (workspace) => {
      this.observe(workspace?.unique, async (unique) => {
        this.#key = unique
        const guard = workspace?.readOnlyGuard
        if (!guard) return
        const managedBy = unique ? await managerOf(unique) : null
        if (unique !== this.#key) return
        if (!managedBy) guard.removeRule(READ_ONLY_RULE)
        else
          guard.addRule({
            unique: READ_ONLY_RULE,
            permitted: true,
            message: managerLine(managedBy),
          })
      })
    })
  }
}

export { CromboloMemberManaged as api }
