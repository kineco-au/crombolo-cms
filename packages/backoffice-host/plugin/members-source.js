/**
 * Story 444: a site whose members another site holds. The Members section says where
 * they are kept, and, while that site isn't answering, says so with Try again. Renaming
 * a member group first warns how many of this site's pages have rules naming it: those
 * rules are rewritten here, and reach the other site with the next change.
 */

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

export const SOURCE_ENDPOINT = () => `${base()}/crombolo/api/members-source`

/** Where members are kept, and whether that site answers; null when they are this site's own. */
export async function membersSource(fetcher = fetch) {
  const response = await fetcher(SOURCE_ENDPOINT(), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  }).catch(() => undefined)
  if (!response?.ok) return null
  const answer = await response.json().catch(() => ({}))
  return typeof answer?.source === 'string' ? answer : null
}

/** How many of this site's pages have a rule naming the group. */
export async function rulesNaming(key, fetcher = fetch) {
  const response = await fetcher(
    `${base()}/crombolo/api/member-groups/${encodeURIComponent(key)}/rules`,
    { credentials: 'include', headers: { accept: 'application/json' } },
  ).catch(() => undefined)
  if (!response?.ok) return null
  return response.json().catch(() => null)
}

/** What the Members section says of where its members are. */
export const keptAtLine = (source) => `Members are kept at ${source}.`

/** What it says while that site isn't answering. */
export const notAnsweringLine = (source) => `Members are kept at ${source}, which isn't answering.`

/** The warning before a rename, when this site's rules name the group. */
export function renameWarning({ pages, from, to, source }) {
  const these = pages === 1 ? '1 page here has a rule' : `${pages} pages here have rules`
  return `${these} naming "${from}". ${pages === 1 ? 'It is' : 'They are'} changed to name "${to}", but its members can't open ${pages === 1 ? 'that page' : 'those pages'} at ${source} until that change arrives there.`
}

export const SOURCE_NOTICE = {
  type: 'sectionSidebarApp',
  alias: 'Crombolo.SectionSidebarApp.MembersSource',
  name: 'Crombolo Members Source',
  element: () => import('./members-source-notice.js'),
  weight: 1000,
  conditions: [{ alias: 'Umb.Condition.SectionAlias', match: 'Umb.Section.Members' }],
}

export const GROUP_SAVE = {
  type: 'workspaceAction',
  kind: 'default',
  alias: 'Crombolo.WorkspaceAction.MemberGroup.Save',
  name: 'Crombolo Save Member Group',
  overwrites: ['Umb.WorkspaceAction.MemberGroup.Save'],
  api: () => import('./members-source-save.js'),
  meta: { label: '#buttons_save', look: 'primary', color: 'positive' },
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.MemberGroup' }],
}

/** What the Members section becomes when another site holds the members. */
export function applyMembersSource(extensionRegistry, answer) {
  if (!answer?.source) return false
  extensionRegistry.register(SOURCE_NOTICE)
  extensionRegistry.register(GROUP_SAVE)
  return true
}

export const onInit = async (_host, extensionRegistry) =>
  applyMembersSource(extensionRegistry, await membersSource())
