/**
 * Preview as a member of a group (story 443): in the preview's toolbar, anyone
 * previewing chooses whether the page is shown signed out or to a member of
 * groups they pick. The server keeps the choice in a cookie of this user's and
 * records each one in the audit log.
 */

const endpoint = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/preview-member`

/** The member groups, and which this user previews as a member of. */
export const readPreviewMember = async () => {
  const response = await fetch(endpoint(), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return { groups: [], chosen: null }
  return response.json()
}

/** Shows the page to a member of these groups' keys, or signed out with none. */
export const choosePreviewMember = async (groups) => {
  const response = await fetch(endpoint(), {
    method: 'PUT',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ groups }),
  })
  if (!response.ok)
    throw new Error(
      (await response.json().catch(() => undefined))?.message ?? 'The choice was not kept.',
    )
  return response.json()
}

/** The toolbar's words for who the page is shown to. Pure. */
export const visitorLabel = (chosen) =>
  chosen?.groups?.length
    ? `A member of ${chosen.groups.map((g) => g.name).join(', ')}`
    : 'Signed out'

/** What the switch says a stand-in member cannot show. */
export const STAND_IN_NOTE =
  'Parts that look the member up show what they show for a member the site does not know.'

export const PREVIEW_MEMBER_APP = {
  type: 'previewApp',
  alias: 'Crombolo.PreviewApps.Member',
  name: 'Crombolo Preview: Member',
  element: () => import('./preview-member-app.js'),
  weight: 305,
}

export const onInit = (_host, extensionRegistry) => {
  extensionRegistry.register(PREVIEW_MEMBER_APP)
}
