/**
 * Story 445: a member a directory outside the site keeps opens read-only, Save hidden,
 * with a line naming who keeps them, and the Members list marks each one. The server
 * refuses the changes too; this says so before anyone types.
 */

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** The flag the server sets on a member a directory keeps. */
export const MANAGED_FLAG = 'Crombolo.Member.Managed'

/** Whether a member, as the Members list holds them, is kept by a directory. */
export const isManaged = (member) =>
  Array.isArray(member?.flags) && member.flags.some((flag) => flag?.alias === MANAGED_FLAG)

/** What a managed member's workspace says. */
export const managerLine = (managedBy) =>
  managedBy ? `Kept by ${managedBy.name}: changes are made there.` : null

/** What the Members list says beside a managed member. */
export const LIST_MARK = 'Kept by a directory'

const asked = new Map()

/**
 * Who keeps a member, or null for the site's own. The workspace's guard, Save and the
 * footer ask together, so an answer is shared for a few seconds, then asked again.
 */
export function managerOf(key, fetcher = fetch) {
  if (!key) return Promise.resolve(null)
  if (!asked.has(key)) {
    asked.set(
      key,
      fetcher(`${base()}/crombolo/api/members/${encodeURIComponent(key)}/manager`, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      })
        .then((response) => (response.ok ? response.json() : {}))
        .then((answer) => answer?.managedBy ?? null)
        .catch(() => null),
    )
    setTimeout(() => asked.delete(key), 5000)
  }
  return asked.get(key)
}

export const NOT_MANAGED_CONDITION = {
  type: 'condition',
  alias: 'Crombolo.Condition.Member.NotManaged',
  name: 'Crombolo Member Not Kept By A Directory',
  api: () => import('./members-managed-condition.js'),
}

export const MANAGED_GUARD = {
  type: 'workspaceContext',
  alias: 'Crombolo.WorkspaceContext.MemberManaged',
  name: 'Crombolo Member Managed',
  api: () => import('./members-managed-guard.js'),
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Member' }],
}

export const MANAGED_LINE = {
  type: 'workspaceFooterApp',
  alias: 'Crombolo.WorkspaceFooterApp.MemberManaged',
  name: 'Crombolo Member Managed Line',
  element: () => import('./members-managed-line.js'),
  weight: 1000,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Member' }],
}

export const MANAGED_TABLE = {
  type: 'collectionView',
  alias: 'Crombolo.CollectionView.Member.Table',
  name: 'Crombolo Member Table Collection View',
  overwrites: ['Umb.CollectionView.Member.Table'],
  element: () => import('./members-managed-table.js'),
  meta: { label: 'Table', icon: 'icon-table', pathName: 'table' },
  conditions: [{ alias: 'Umb.Condition.CollectionAlias', match: 'Umb.Collection.Member' }],
}

/** What the Members section becomes: managed members read-only and marked. */
export function applyMembersManaged(extensionRegistry) {
  extensionRegistry.register(NOT_MANAGED_CONDITION)
  extensionRegistry.appendCondition('Umb.WorkspaceAction.Member.Save', {
    alias: NOT_MANAGED_CONDITION.alias,
  })
  extensionRegistry.register(MANAGED_GUARD)
  extensionRegistry.register(MANAGED_LINE)
  extensionRegistry.register(MANAGED_TABLE)
}

export const onInit = (_host, extensionRegistry) => applyMembersManaged(extensionRegistry)
