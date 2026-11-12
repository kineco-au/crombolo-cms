/**
 * The words of Settings → Schema and of a schema import waiting on the Changes
 * dashboard (story 342). Pure, so the unit tests read it outside a browser.
 */

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

/**
 * What an import brings, in a phrase: "2 new files and 1 changed file".
 *
 * @param {{ added?: string[], changed?: string[] }} change
 * @returns {string}
 */
export function describeImport({ added = [], changed = [] }) {
  const parts = []
  if (added.length > 0) parts.push(plural(added.length, 'new file', 'new files'))
  if (changed.length > 0) parts.push(plural(changed.length, 'changed file', 'changed files'))
  return parts.join(' and ') || 'no files'
}

/** What a folder in the schema holds, in words, for the list of files an import brings. */
const FOLDER = {
  'content-types': 'Document type',
  'media-types': 'Media type',
  'member-types': 'Member type',
  'data-types': 'Data type',
  forms: 'Form',
  workflows: 'Approval workflow',
  'user-groups': 'User group',
  webhooks: 'Webhook',
}

/**
 * A file an import brings, as what it is and its name.
 *
 * @param {string} path
 * @returns {{ kind: string, name: string }}
 */
export function describeFile(path) {
  const [folder = '', ...rest] = path.split('/')
  if (rest.length === 0)
    return {
      kind: folder === 'languages.toml' ? 'Languages' : 'Schema version',
      name: folder,
    }
  return { kind: FOLDER[folder] ?? folder, name: rest.join('/').replace(/\.toml$/, '') }
}

/** The files an upload may be. */
export const ACCEPT = '.zip,.toml'
