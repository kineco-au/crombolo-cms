/**
 * Forms and workflows as a tree (story 289): folders from their paths, each
 * with its folders and its items. Pure, so it is tested on its own.
 */

const byName = (a, b) => a.name.localeCompare(b.name)

/**
 * @param {{ alias: string, name: string, folder?: string }[]} items
 * @param {string[]} folders every folder as `a/b`, empty ones included
 * @returns {{ name: string, path: string, folders: any[], items: any[] }}
 */
export function definitionTree(items, folders) {
  const root = { name: '', path: '', folders: [], items: [] }
  const nodes = new Map([['', root]])
  const nodeFor = (path) => {
    const found = nodes.get(path)
    if (found) return found
    const slash = path.lastIndexOf('/')
    const parent = nodeFor(slash === -1 ? '' : path.slice(0, slash))
    const node = { name: path.slice(slash + 1), path, folders: [], items: [] }
    parent.folders.push(node)
    nodes.set(path, node)
    return node
  }
  for (const folder of folders) nodeFor(folder)
  for (const item of items) nodeFor(item.folder ?? '').items.push(item)
  const sort = (node) => {
    node.folders.sort(byName)
    node.items.sort(byName)
    node.folders.forEach(sort)
  }
  sort(root)
  return root
}

/** Why a kind cannot be changed here, in words for the person reading it, or undefined. */
export function readOnlyWords(kind, because) {
  if (because === 'site')
    return `${kind} are kept with this site's files, so they can't be changed here. To change one, edit it in the site's code and deploy it.`
  if (because === 'permission') return `Only administrators can change ${kind.toLowerCase()}.`
  return undefined
}
