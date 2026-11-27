/**
 * Parts of a view in the template editor (story 264): the note on a file that
 * shows the signed-in member, and the inserts that put another view in this
 * one, a tag at the cursor and its import at the top. "A personalised part"
 * inserts one fetched for each visitor, chosen or made new.
 */

const DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])(use deferred|use client)\1/

/** Whether a view loads on its own: a personalised part, or one that runs in the browser. Pure. */
export const loadsSeparately = (source) => DIRECTIVE.test(source)

/** `source` with its comments blanked, keeping every line and column where it was. Pure. */
const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '))

export const MEMBER_NOTE =
  "This shows the signed-in member, so a page using it is shown to each member on their own, never shared with them. To share it, move what shows the member into a file of its own that starts with 'use deferred', a personalised part."

/** Where a view mentions the member, one note per line, unless it loads separately. Pure. */
export const memberNotes = (source) => {
  if (loadsSeparately(source)) return []
  const notes = []
  withoutComments(source)
    .split('\n')
    .forEach((text, index) => {
      const found = /\bmember\b/.exec(text)
      if (found)
        notes.push({
          line: index + 1,
          start: found.index + 1,
          end: found.index + 1 + 'member'.length,
          message: MEMBER_NOTE,
        })
    })
  return notes
}

/** A component's name from its file: `shared/user-menu.tsx` is `UserMenu`. Pure. */
export const componentName = (path) => {
  const base = (path.split('/').pop() ?? 'part').replace(/\.[jt]sx?$/, '')
  const words = base.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('')
  return /^[A-Za-z]/.test(name) ? name : `Part${name}`
}

/** A view's path as the partial view insert names it, under `components/`: `/shared/greeting.tsx`. */
const viewPath = (name) =>
  `/${name
    .replace(/%25dot%25|%dot%/g, '.')
    .replace(/^\/+/, '')
    .replace(/\.(cshtml|[jt]sx?)$/, '')}.tsx`

/** A new part's file name from what was typed: `User menu` is `user-menu.tsx`. Pure. */
export const partFileName = (typed) => {
  const slug = typed
    .trim()
    .toLowerCase()
    .replace(/\.[jt]sx?$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug ? `${slug}.tsx` : ''
}

const PERSONALISED = 'crombolo:personalised-part:'

/** What a personalised part's insert hands the editor, for `partInsert` to write. */
export const personalisedPartSnippet = (path) => `${PERSONALISED}${path}`

/**
 * A view put in this one: Umbraco's partial view insert, or a personalised
 * part, as the tag at the cursor and the file to import. Undefined for any
 * other insert. Pure.
 */
export const partInsert = (text) => {
  if (typeof text !== 'string') return undefined
  if (text.startsWith(PERSONALISED)) {
    const path = viewPath(text.slice(PERSONALISED.length))
    return {
      path,
      tag: `<${componentName(path)} fallback={<span>Loading…</span>} />`,
    }
  }
  const partial = /^@await Html\.PartialAsync\("([^"]+)"\)$/.exec(text)
  if (!partial) return undefined
  const path = viewPath(partial[1])
  return { path, tag: `<${componentName(path)} />` }
}

/** The import of `path` from the view at `from`, both under `components/`. Pure. */
export const importFor = (path, from) => {
  const target = path.split('/').filter(Boolean)
  const here = (from ?? '/view.tsx').split('/').filter(Boolean).slice(0, -1)
  let shared = 0
  while (shared < here.length && shared < target.length - 1 && here[shared] === target[shared])
    shared += 1
  const up = here.length - shared
  const relative = [...(up === 0 ? ['.'] : Array(up).fill('..')), ...target.slice(shared)].join('/')
  return `import ${componentName(path)} from '${relative}'`
}

/** `source` with `line` among its imports, unless it already imports that file. Pure. */
export const withImport = (source, line) => {
  const from = /from '([^']+)'/.exec(line)?.[1]
  if (from && source.includes(`'${from}'`)) return source
  const imports = /^(?:import[^\n]*\n)*/.exec(source)?.[0] ?? ''
  return `${imports}${line}\n${source.slice(imports.length)}`
}

export const PERSONALISED_PART_MODAL = 'Crombolo.Modal.PersonalisedPart'

export const PERSONALISED_PART_DIALOG = {
  type: 'modal',
  alias: PERSONALISED_PART_MODAL,
  name: 'Crombolo Personalised Part Dialog',
  element: () => import('./personalised-part-modal.js'),
}

/** The Insert menu's "A personalised part": a chosen one, or a new one made from the starter. */
export const personalisedPartInsert = {
  label: 'A personalised part',
  async pick(host) {
    const { umbOpenModal } = await import('@umbraco-cms/backoffice/modal')
    const chosen = await umbOpenModal(host, PERSONALISED_PART_MODAL, { data: {} }).catch(
      () => undefined,
    )
    return chosen?.path ? personalisedPartSnippet(chosen.path) : undefined
  },
}

const FILE_LINK = 'crombolo:file-link:'

/** The File type's key, as the picker sees an item's type (story 450). */
export const FILE_TYPE_KEY = '8d9df7ad-2312-4fb9-9f44-7fb37e3690a8'

/** What "A link to a file" hands the editor, for `fileLinkInsert` to write. */
export const fileLinkSnippet = (path) => `${FILE_LINK}${path}`

/**
 * A link to a File put in a view (story 450): `<a href={file('/docs/agents.md')}>agents.md</a>`
 * at the cursor, and `file` imported from the package. Undefined for any other insert. Pure.
 */
export const fileLinkInsert = (text) => {
  if (typeof text !== 'string' || !text.startsWith(FILE_LINK)) return undefined
  const path = text.slice(FILE_LINK.length)
  const name = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? path)
  const quoted = path.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
  const shown = name.replace(/[{}<>]/g, (c) => `{'${c}'}`)
  return { tag: `<a href={file('${quoted}')}>${shown}</a>` }
}

/**
 * `source` importing `name` from `from`: added to an import of that package it
 * already has, or as a line of its own. A type-only import is left alone. Pure.
 */
export const withNamedImport = (source, name, from) => {
  const existing = new RegExp(
    `^import\\s+\\{([^}]*)\\}\\s+from\\s+['"]${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`,
    'm',
  ).exec(source)
  if (existing) {
    const names = existing[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (names.some((n) => n === name || n.endsWith(` as ${name}`))) return source
    const line = existing[0].replace(existing[1], ` ${[...names, name].join(', ')} `)
    return `${source.slice(0, existing.index)}${line}${source.slice(existing.index + existing[0].length)}`
  }
  const imports = /^(?:import[^\n]*\n)*/.exec(source)?.[0] ?? ''
  return `${imports}import { ${name} } from '${from}'\n${source.slice(imports.length)}`
}

/** The Insert menu's "A link to a file": a File chosen from the content tree, linked by its path. */
export const fileLinkInsertEntry = {
  label: 'A link to a file',
  async pick(host) {
    const { umbOpenModal } = await import('@umbraco-cms/backoffice/modal')
    const { UMB_DOCUMENT_PICKER_MODAL } = await import('@umbraco-cms/backoffice/document')
    const picked = await umbOpenModal(host, UMB_DOCUMENT_PICKER_MODAL, {
      data: {
        multiple: false,
        pickableFilter: (item) => item.documentType?.unique === FILE_TYPE_KEY,
      },
    }).catch(() => undefined)
    const unique = picked?.selection?.[0]
    if (!unique) return undefined
    const { DocumentService } = await import('@umbraco-cms/backoffice/external/backend-api')
    const { data } = await DocumentService.getDocumentUrls({ query: { id: [unique] } })
    const url = data?.[0]?.urlInfos?.find((info) => info.url)?.url
    if (!url) return undefined
    const path = url.startsWith('//')
      ? url.slice(url.indexOf('/', 2))
      : url.replace(/^https?:\/\/[^/]+/, '')
    return fileLinkSnippet(path)
  },
}

/** The folder a view sits in under `components/`: `/pages`, or nothing for the top. */
export const folderOf = (file) => {
  const folder = (file ?? '').replace(/^\/*/, '/').replace(/\/[^/]*$/, '')
  return folder === '/' ? '' : folder
}

/** The extension a view opens with in the editor: a module's `.ts`, else a component's `.tsx`. */
export const modelExtension = (file) => (file?.endsWith('.ts') ? '.ts' : '.tsx')

/**
 * The file a create page will make, as a path under `components/`, from its address.
 * Its name isn't known yet, but its folder and kind are, and they are what the editor needs.
 *
 * @param {string} pathname
 */
export function fileBeingCreated(pathname) {
  const found = /\/workspace\/partial-view\/create\/parent\/[^/]+\/([^/]+)(\/module)?/.exec(
    pathname,
  )
  if (!found) return undefined
  const folder = found[1] === 'null' ? '' : decodeURIComponent(found[1]).replace(/\/$/, '')
  return `${folder}/new${found[2] ? '.ts' : '.tsx'}`
}
