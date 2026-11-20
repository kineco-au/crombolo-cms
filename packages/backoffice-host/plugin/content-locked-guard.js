/**
 * An item on a site that takes its content by change, read only (story 388): the state
 * the workspace uses for a trashed item. Registered by `content-locked.js`.
 */
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api'
import { UMB_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/workspace'
import { LOCKED_LINE } from './content-locked.js'

const READ_ONLY_RULE = 'CROMBOLO_CONTENT_LOCKED'

export class CromboloContentLocked extends UmbControllerBase {
  constructor(host) {
    super(host)
    this.consumeContext(UMB_WORKSPACE_CONTEXT, (workspace) => {
      workspace?.readOnlyGuard?.addRule({
        unique: READ_ONLY_RULE,
        permitted: true,
        message: LOCKED_LINE,
      })
    })
  }
}

export { CromboloContentLocked as api }
