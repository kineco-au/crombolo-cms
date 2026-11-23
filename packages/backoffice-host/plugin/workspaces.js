/**
 * Workspaces in the back office (story 384). Where workspaces are on: every
 * Management API call goes in this tab's workspace; the trees mark what it changed; a
 * page's Info shows how it differs from Shared, and that another workspace changed it;
 * an edit begun in Shared can be saved in a new workspace; and where a workspace is
 * required, Shared is looked at only. The switch at the head of Content is
 * `workspace-switch.js`. With workspaces off, none of this shows.
 */
import { umbHttpClient } from '@umbraco-cms/backoffice/http-client'
import { onceKnown, workspacesApi } from './workspace-client.js'

export const WORKSPACE_SIGN = {
  type: 'entitySign',
  kind: 'icon',
  alias: 'Crombolo.EntitySign.WorkspaceChanged',
  name: 'Crombolo Changed In This Workspace',
  forEntityTypes: ['document'],
  forEntityFlags: ['Crombolo.Workspace.Changed'],
  meta: { iconName: 'icon-edit', label: 'Changed in this workspace' },
}

export const WORKSPACE_INFO = {
  type: 'workspaceInfoApp',
  alias: 'Crombolo.WorkspaceInfoApp.Workspace',
  name: 'Crombolo Workspace Info',
  element: () => import('./workspace-info.js'),
  weight: 900,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Document' }],
}

export const WORKSPACE_MOVE = {
  type: 'workspaceAction',
  kind: 'default',
  alias: 'Crombolo.WorkspaceAction.Document.SaveInNewWorkspace',
  name: 'Crombolo Save In A New Workspace',
  api: () => import('./workspace-move-action.js'),
  weight: 70,
  meta: { label: 'Save in a new workspace', look: 'secondary' },
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
  extensionRegistry.register(WORKSPACE_SIGN)
  extensionRegistry.register(WORKSPACE_INFO)
  extensionRegistry.register(WORKSPACE_MOVE)
  if (mine.required) extensionRegistry.register(SHARED_READ_ONLY)
}
