/**
 * What a page's template picker shows (`template-picker.js`): every component as
 * a tree of the folders `components/` keeps it in, each saying whether the page's
 * content type allows it, and that tree narrowed to a search. A template's alias
 * is its path, so its folders are the alias's parts before the last `/`. Pure, so
 * each is tested on its own.
 */

/**
 * A component: `id` is its template's key, null while nothing names it.
 * @typedef {{ id: string | null, name: string, alias: string, allowed: boolean }} TemplateItem
 * @typedef {{ name: string, path: string, folders: TemplateFolder[], items: TemplateItem[] }} TemplateFolder
 */

/** A component's name: the last part of its path. */
export const componentName = (alias) => alias.slice(alias.lastIndexOf('/') + 1)

/**
 * @param {{ id: string | null, name: string, alias: string }[]} templates
 * @param {string[]} allowedIds
 * @returns {TemplateFolder} the root: its own components, and its folders
 */
export function templateTree(templates, allowedIds) {
  const allowed = new Set(allowedIds.map((id) => id.toLowerCase()))
  const root = { name: '', path: '', folders: [], items: [] }
  for (const template of templates) {
    const parts = template.alias.split('/').slice(0, -1)
    let at = root
    for (const part of parts) {
      const path = at.path ? `${at.path}/${part}` : part
      let next = at.folders.find((folder) => folder.name === part)
      if (!next) {
        next = { name: part, path, folders: [], items: [] }
        at.folders.push(next)
      }
      at = next
    }
    at.items.push({
      ...template,
      allowed: template.id !== null && allowed.has(template.id.toLowerCase()),
    })
  }
  const sort = (folder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name))
    folder.items.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of folder.folders) sort(child)
    return folder
  }
  return sort(root)
}

/**
 * The tree with only the components whose name or path holds `query`, and the
 * folders that lead to them; the same tree for no query.
 *
 * @param {TemplateFolder} folder
 * @param {string} query
 * @returns {TemplateFolder}
 */
export function filterTree(folder, query) {
  const q = query.trim().toLowerCase()
  if (!q) return folder
  const narrow = (at) => ({
    ...at,
    items: at.items.filter(
      (item) => item.name.toLowerCase().includes(q) || item.alias.toLowerCase().includes(q),
    ),
    folders: at.folders.map(narrow).filter((f) => f.items.length > 0 || f.folders.length > 0),
  })
  return narrow(folder)
}

/** The content type's allowed templates with one more, as its update sends them. Pure. */
export function withAllowed(allowedTemplates, id) {
  const list = allowedTemplates ?? []
  return list.some((t) => t.id.toLowerCase() === id.toLowerCase()) ? list : [...list, { id }]
}
