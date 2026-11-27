/**
 * Save for a member group whose members another site holds (story 444): a rename first
 * warns how many of this site's pages have rules naming the group, and saves only when
 * asked to rename anyway. Registered by `members-source.js`.
 */
import { UmbSubmitWorkspaceAction } from '@umbraco-cms/backoffice/workspace'
import { ask } from './ask.js'
import { membersSource, renameWarning, rulesNaming } from './members-source.js'

export class CromboloMemberGroupSaveAction extends UmbSubmitWorkspaceAction {
  async execute() {
    await this._retrieveWorkspaceContext
    const workspace = this._workspaceContext
    const key = workspace?.getUnique?.()
    const from = workspace?.getPersistedData?.()?.name
    const to = workspace?.getName?.()
    if (key && from && to && from !== to) {
      const rules = await rulesNaming(key)
      if (rules?.rewritten && rules.pages > 0) {
        const source = (await membersSource())?.source ?? 'the site that holds the members'
        const go = await ask(this, {
          headline: `Rename "${from}"?`,
          content: renameWarning({ pages: rules.pages, from, to, source }),
          confirmLabel: 'Rename anyway',
          color: 'warning',
        })
        if (!go) return
      }
    }
    return super.execute()
  }
}

export { CromboloMemberGroupSaveAction as api }
