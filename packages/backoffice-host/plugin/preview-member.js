/**
 * Preview as a member (story 264): in the preview's toolbar, a user who can
 * open Members chooses whether the page is shown signed out or as a member
 * they pick. The server keeps the choice in a cookie of this user's, records
 * each one in the audit log, and refuses it to anyone without Members.
 */

const endpoint = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/preview-member`

/** Who the preview shows the page as, and whether this user may choose. */
export const readPreviewMember = async () => {
  const response = await fetch(endpoint(), {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) return { allowed: false, member: null }
  return response.json()
}

/** Shows the page as this member, or signed out with null. */
export const choosePreviewMember = async (member) => {
  const response = await fetch(endpoint(), {
    method: 'PUT',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ member }),
  })
  if (!response.ok) throw new Error(`The server answered ${response.status}.`)
  return response.json()
}

/** The toolbar's words for who the page is shown as. Pure. */
export const visitorLabel = (member) => (member ? `As ${member.name}` : 'Signed out')

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
