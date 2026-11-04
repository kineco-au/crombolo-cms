/**
 * Whether a page's copies are shared, on the document's Info tab (story 264).
 * The server renders the published page as a signed-out visitor and says how
 * long copies are kept, whether a check is answered without rendering, and
 * which view files show the signed-in member, which make it rendered for each
 * member. Each file links to its editor. docs/rendering.md, "Caching, inferred".
 */

const backOffice = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** What the server says about a page's copies. */
export const readPageSharing = async (key, culture) => {
  const query = culture ? `?culture=${encodeURIComponent(culture)}` : ''
  const response = await fetch(
    `${backOffice()}/crombolo/api/page-sharing/${encodeURIComponent(key)}${query}`,
    { credentials: 'include', headers: { accept: 'application/json' } },
  )
  if (!response.ok) throw new Error(`The server answered ${response.status}.`)
  return response.json()
}

/** Seconds as a person says them: "5 minutes", "1 hour". */
export const duration = (seconds) => {
  const units = [
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ]
  for (const [size, name] of units)
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size
      return `${count} ${name}${count === 1 ? '' : 's'}`
    }
  return `${seconds} seconds`
}

/** The editor of a view file, by its path under the views: `/shared/layout.tsx`. */
export const fileEditorHref = (path, base = backOffice()) =>
  `${base}/section/settings/workspace/partial-view/edit/${encodeURIComponent(path.replace('.', '%dot%'))}`

/**
 * The Info tab's words for a page: a headline sentence, and the files that
 * make it each member's, if any. Pure.
 */
export const describeSharing = (state) => {
  switch (state?.status) {
    case 'unpublished':
      return { text: 'Not published, so there is nothing to share yet.', files: [] }
    case 'membersOnly':
      return { text: 'Members only: shown to each member on their own, never shared.', files: [] }
    case 'notRendered':
      return {
        text: `It could not be shown to check${state.message ? `: ${state.message}` : '.'}`,
        files: [],
      }
    case 'notShared':
      return {
        text: 'Not shared: it reads something from each visit, such as cookies or the address’s query.',
        files: [],
      }
    case 'shared': {
      const kept =
        state.keptFor === null || state.keptFor === undefined
          ? 'shared with every visitor, though the site sets no time to keep copies'
          : state.keptFor === 0
            ? 'shared with every visitor, but no copies are kept'
            : `kept for ${duration(state.keptFor)}${state.checkedWithoutRendering ? ', checked without rendering' : ''}`
      const files = state.memberFiles ?? []
      if (files.length === 0) return { text: `Copies are ${kept}.`, files }
      return {
        text: `Copies are ${kept} for signed-out visitors, and shown to each signed-in member on their own, because ${files.length === 1 ? 'this file shows' : 'these files show'} the signed-in member. Move that part into a file of its own and mark it to load separately, and the page is shared with members too.`,
        files,
      }
    }
    default:
      return undefined
  }
}

export const PAGE_SHARING_INFO = {
  type: 'workspaceInfoApp',
  alias: 'Crombolo.WorkspaceInfoApp.Document.Sharing',
  name: 'Crombolo Page Sharing Info',
  element: () => import('./page-sharing-info.js'),
  weight: 85,
  conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Document' }],
}

export const onInit = (_host, extensionRegistry) => {
  extensionRegistry.register(PAGE_SHARING_INFO)
}
