/**
 * Where a workspace is required (story 384), Shared opened to look at is read only:
 * every change is made in a workspace. Registered by `workspaces.js`.
 */
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api'
import { UMB_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/workspace'
import { currentWorkspace } from './workspace-client.js'

export class CromboloSharedReadOnly extends UmbControllerBase {
  constructor(host) {
    super(host)
    if (currentWorkspace()?.key !== 'shared') return
    this.consumeContext(UMB_WORKSPACE_CONTEXT, (workspace) => {
      workspace?.readOnlyGuard?.addRule({
        unique: 'CROMBOLO_SHARED_READ_ONLY',
        permitted: true,
        message: 'Shared is looked at here: changes are made in a workspace.',
      })
    })
  }
}

export { CromboloSharedReadOnly as api }
