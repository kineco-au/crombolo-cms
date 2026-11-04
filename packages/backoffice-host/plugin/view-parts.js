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
