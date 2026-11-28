/**
 * A File's name in its workspace header (story 450): typed without its ending, the
 * ending chosen from the kinds of File the site serves, Markdown for a new one. The
 * fork's `nameSuffixes` seam draws it; this answers it for the File type only. And
 * the preview's switch between a Markdown File's source and its rendered HTML.
 */
import { nameSuffixes } from './file-kinds.js'
import { FILE_TYPE_KEY } from './view-parts.js'

/** The seam's answer: the File type's endings, and nothing for any other type. Pure. */
export const suffixesFor = (contentTypeUnique) =>
  String(contentTypeUnique).toLowerCase() === FILE_TYPE_KEY ? nameSuffixes() : undefined

/** The cookie and header the server's preview of a Markdown File reads and answers. */
export const MARKDOWN_VIEW_COOKIE = 'crombolo-preview-markdown'
export const MARKDOWN_VIEW_HEADER = 'x-crombolo-markdown'

export const MARKDOWN_VIEWS = [
  { value: 'source', label: 'Markdown' },
  { value: 'rendered', label: 'Rendered' },
]

export const MARKDOWN_PREVIEW_APP = {
  type: 'previewApp',
  alias: 'Crombolo.PreviewApps.Markdown',
  name: 'Crombolo Preview: Markdown',
  element: () => import('./markdown-preview-app.js'),
  weight: 310,
}

export const onInit = async (_host, extensionRegistry) => {
  extensionRegistry?.register(MARKDOWN_PREVIEW_APP)
  const { umbCromboloHooks } = await import('@umbraco-cms/backoffice/extension-registry')
  umbCromboloHooks.nameSuffixes = suffixesFor
}
