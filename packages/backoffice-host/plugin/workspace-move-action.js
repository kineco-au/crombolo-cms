/**
 * "Save in a new workspace" (story 384): an edit begun in Shared, saved instead in a
 * workspace opened for it, which this tab then works in. Registered by `workspaces.js`.
 */
import { UMB_DOCUMENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/document'
import { UmbWorkspaceActionBase } from '@umbraco-cms/backoffice/workspace'
import { chooseWorkspace, currentWorkspace, workspacesApi } from './workspace-client.js'

export class CromboloSaveInNewWorkspaceAction extends UmbWorkspaceActionBase {
  async execute() {
    const workspace = await this.getContext(UMB_DOCUMENT_WORKSPACE_CONTEXT)
    if (!workspace) return
    const current = currentWorkspace()
    const name = globalThis.prompt?.(
      current?.key && current.key !== 'shared'
        ? 'A new workspace, for this edit:'
        : 'Save this edit in a new workspace called:',
    )
    if (!name?.trim()) return
    const opened = await workspacesApi.open(name.trim())
    chooseWorkspace(opened)
    // Saved with the header the tab now sends: in the new workspace, not in Shared.
    await workspace.requestSubmit()
    location.reload()
  }
}

export { CromboloSaveInNewWorkspaceAction as api }
