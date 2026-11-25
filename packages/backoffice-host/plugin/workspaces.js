/**
 * Workspaces in the back office (story 384). Where workspaces are on: every
 * Management API call goes in this tab's workspace; every tree marks what it holds
 * (`item-marks.js`); a
 * page's Info shows how it differs from Shared, and that another workspace changed it;
 * and where a workspace is
 * required, Shared is looked at only. The switch at the head of Content is
 * `workspace-switch.js`. With workspaces off, none of this shows.
 */
import { umbHttpClient } from '@umbraco-cms/backoffice/http-client'
import { onceKnown, tellWorkspacesChanged, workspacesApi } from './workspace-client.js'

export const WORKSPACE_INFO = {
  type: 'workspaceInfoApp',
  alias: 'Crombolo.WorkspaceInfoApp.Workspace',
  name: 'Crombolo Workspace Info',
  element: () => import('./workspace-info.js'),
  weight: 900,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Document' }],
}

export const SHARED_READ_ONLY = {
  type: 'workspaceContext',
  alias: 'Crombolo.WorkspaceContext.SharedReadOnly',
  name: 'Crombolo Shared Read Only',
  api: () => import('./workspace-shared-guard.js'),
  conditions: [
    {
      alias: 'Umb.Condition.WorkspaceAlias',
      oneOf: ['Umb.Workspace.Document', 'Umb.Workspace.Media'],
    },
  ],
}

export const onInit = async (_host, extensionRegistry) => {
  const asked = workspacesApi.mine().catch(() => undefined)
  umbHttpClient.interceptors.request.use(onceKnown(asked))
  const mine = await asked
  if (!mine?.enabled) return
  // Whatever was just saved may be a change in the workspace: its controls count again.
  umbHttpClient.interceptors.response.use((response, request) => {
    if (response?.ok && request?.method && request.method !== 'GET') tellWorkspacesChanged()
    return response
  })
  // What the workspace holds is marked beside each item, in every tree, by one element.
  await import('./item-marks.js')
  extensionRegistry.register(WORKSPACE_INFO)
  if (mine.required) extensionRegistry.register(SHARED_READ_ONLY)
}
