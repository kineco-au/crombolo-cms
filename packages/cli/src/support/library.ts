/**
 * Library elements and their folders from the command line (story 361). A
 * Library item is named `library:/<folder…>/<name>`, as content files write the
 * path after the scheme, or by its key; `library:/` is the Library's top. A path
 * with no scheme is always a page, so no page name is reserved. Every write goes
 * through the Library operations, as the person at this command line.
 */
import { hasSection } from '@crombolo/api-management/domain'
import { type ElementOperations, mayInLibrary, type Refusal } from '@crombolo/content'
import type { ElementWriteKind } from '@crombolo/content/rules'
import {
  type ContentTypeAggregate,
  type DocumentAggregate,
  type DocumentValidationError,
  ObjectTypes,
} from '@crombolo/core'
import {
  currentSchemaState,
  type Db,
  DocumentRepository,
  describeRefFailure,
  looksLikeKey,
  NodeRepository,
  type NodeRow,
  pathSegments,
  resolveNodeRef,
} from '@crombolo/data'
import { type PropertyEditor, siteElementOperations } from '@crombolo/server'
import { CliError } from '../errors.ts'
import { commandActor, signedInPerson } from './acting.ts'
import { type PageSite, withPages } from './pages.ts'
import { withSite } from './tree.ts'

export const LIBRARY_SCHEME = 'library:'

const LIBRARY_TYPES: readonly string[] = [ObjectTypes.ElementContainer, ObjectTypes.Element]
const isLibraryNode = (node: NodeRow) => LIBRARY_TYPES.includes(node.objectType as string)
export const isFolder = (node: NodeRow) => node.objectType === ObjectTypes.ElementContainer

/** The path after `library:`, when a reference has the scheme; undefined otherwise. */
export function libraryPath(ref: string): string | undefined {
  const trimmed = ref.trim()
  return trimmed.toLowerCase().startsWith(LIBRARY_SCHEME)
    ? trimmed.slice(LIBRARY_SCHEME.length)
    : undefined
}

/**
 * Whether a reference names something in the Library: one with the scheme, or a
 * key the Library has. A key is looked up among pages and the Library alike.
 */
export async function inLibrary(db: Db, ref: string): Promise<boolean> {
  if (libraryPath(ref) !== undefined) return true
  if (!looksLikeKey(ref.trim())) return false
  const node = await new NodeRepository(db).byKey(ref.trim())
  return node !== undefined && isLibraryNode(node)
}

/** Whether a reference is the Library's top, `library:/`. */
export const isLibraryTop = (ref: string): boolean => {
  const path = libraryPath(ref)
  return path !== undefined && pathSegments(path).length === 0
}

/** A hint at the Library form, when a page path names nothing but the Library has it. */
export async function libraryHint(db: Db, ref: string): Promise<{ hint: string } | undefined> {
  if (looksLikeKey(ref.trim()) || libraryPath(ref) !== undefined) return undefined
  const found = await resolveNodeRef(db, LIBRARY_TYPES, ref)
  return found.ok && isLibraryNode(found.node)
    ? { hint: `In the Library, name it library:/${pathSegments(ref).join('/')}` }
    : undefined
}

/** A hint at the page form, when a Library path names nothing but a page has it. */
async function pageHint(db: Db, ref: string): Promise<{ hint: string } | undefined> {
  const path = libraryPath(ref)
  if (path === undefined) return undefined
  const found = await resolveNodeRef(db, [ObjectTypes.Document], path)
  return found.ok && found.node.objectType === ObjectTypes.Document
    ? { hint: `A page is named by its path alone: /${pathSegments(path).join('/')}` }
    : undefined
}

/** The Library item a reference names: an element or a folder; null for the top. */
export async function resolveLibrary(db: Db, ref: string): Promise<NodeRow | null> {
  const path = libraryPath(ref)
  if (path !== undefined && pathSegments(path).length === 0) return null
  const resolved = await resolveNodeRef(db, LIBRARY_TYPES, path ?? ref)
  if (!resolved.ok)
    throw new CliError('not_found', describeRefFailure(ref, resolved), await pageHint(db, ref))
  if (!isLibraryNode(resolved.node))
    throw new CliError('not_found', `"${ref}" is not in the Library.`, {
      hint: 'A page is named by its path or key with no library: in front.',
    })
  return resolved.node
}

/** A page path given where a Library item is needed, or the reverse, refused naming the other. */
export function oneKind(refs: ReadonlyArray<{ ref: string; library: boolean }>): boolean {
  const library = refs.filter((r) => r.library)
  if (library.length > 0 && library.length < refs.length)
    throw new CliError(
      'usage',
      'Name pages or Library items, not both: each is checked by its own rules.',
      {
        hint: 'Run it once for the pages and once for the Library items, named library:/…',
      },
    )
  return library.length > 0
}

/** A Library item's place by name: `library:/Menus/Main`. */
export async function libraryPathOf(db: Db, node: NodeRow | null): Promise<string> {
  if (!node) return `${LIBRARY_SCHEME}/`
  const ids = node.path
    .split(',')
    .map(Number)
    .filter((id) => id > 0)
  const byId = new Map((await new NodeRepository(db).byIds(ids)).map((row) => [row.id, row]))
  const names = ids.flatMap((id) => {
    const row = byId.get(id)
    return row && isLibraryNode(row) ? [row.text ?? row.key] : []
  })
  return `${LIBRARY_SCHEME}/${names.join('/')}`
}

/** The section a path needs, for someone signed in: Library for the Library, else Content. */
export function needSection(library: boolean): void {
  const person = signedInPerson()
  const section = library ? 'library' : 'content'
  if (person && !hasSection(person, section))
    throw new CliError(
      'refused',
      library
        ? "The Library needs the Library section, which your groups don't give you."
        : "Pages need the Content section, which your groups don't give you.",
    )
}

/** A Library verb the person signed in needs before anything is read or changed. */
export function needLibraryVerb(kind: ElementWriteKind): void {
  const person = signedInPerson()
  if (person && !mayInLibrary(person, kind))
    throw new CliError('refused', 'You may not do that in the Library.')
}

export interface LibrarySite extends PageSite {
  library: ElementOperations
  elements: DocumentRepository
}

/** The site's database, the page site and the Library operations, for one command. */
export async function withLibrary<T>(work: (site: LibrarySite) => Promise<T>): Promise<T> {
  return withPages(async (site) => {
    const state = await currentSchemaState(site.db)
    return work({
      ...site,
      library: await siteElementOperations(site.db, site.config),
      elements: new DocumentRepository(site.db, {
        kind: 'element',
        nodeState: { version: state.version, revision: state.revision },
      }),
    })
  })
}

export interface FoundElement {
  folder: false
  node: NodeRow
  doc: DocumentAggregate
  type: ContentTypeAggregate
  editors: Map<string, PropertyEditor>
  /** `library:/Menus/Main` */
  path: string
}

export interface FoundFolder {
  folder: true
  node: NodeRow
  path: string
}

/** The element a reference names, with its type and its properties' editors, or the folder. */
export async function findLibraryItem(
  site: LibrarySite,
  ref: string,
): Promise<FoundElement | FoundFolder> {
  const node = await resolveLibrary(site.db, ref)
  if (!node) throw new CliError('usage', 'library:/ is the top of the Library: name an item in it.')
  const path = await libraryPathOf(site.db, node)
  if (isFolder(node)) return { folder: true, node, path }
  const doc = await site.elements.byKey(node.key)
  if (!doc) throw new CliError('not_found', `"${ref}" is not in the Library.`)
  const type = await site.lookup.typeByKey('document', doc.contentTypeKey)
  if (!type) throw new CliError('not_found', `The type of "${ref}" is not on this site.`)
  return {
    folder: false,
    node,
    doc,
    type,
    editors: await site.lookup.editorsOf('document', type),
    path,
  }
}

/** The element a reference names; a folder refused. */
export async function findElement(site: LibrarySite, ref: string): Promise<FoundElement> {
  const found = await findLibraryItem(site, ref)
  if (found.folder)
    throw new CliError('refused', `${found.path} is a Library folder, not an element.`)
  return found
}

/** A Library operation's refusal as the command's failure, with each property's reasons. */
export function refusedInLibrary(result: Refusal): CliError {
  const errors = (result as { errors?: DocumentValidationError[] }).errors ?? []
  return new CliError(
    result.kind === 'notFound' ? 'not_found' : 'refused',
    `Nothing was changed: ${result.reason}`,
    errors.length > 0
      ? {
          details: errors.map(
            (e) => `${e.alias}${e.culture ? ` (${e.culture})` : ''}: ${e.messages.join('; ')}`,
          ),
        }
      : undefined,
  )
}

/** The person at this command line, under the rules a back office Library write follows. */
export const libraryActor = () => commandActor()

/** What a draft says about going live. */
export const draftNote = (path: string) =>
  `\nA draft: \`crombolo content publish ${path}\` or --publish takes it live.`

/** Whether a command's reference is in the Library, opening the site only to look a key up. */
export async function refersToLibrary(ref: string): Promise<boolean> {
  if (libraryPath(ref) !== undefined) return true
  if (!looksLikeKey(ref.trim())) return false
  return withSite((db) => inLibrary(db, ref))
}

/** A Library path given where a page is needed, refused naming the page form. */
export function notALibraryPath(ref: string, what = 'This'): void {
  const path = libraryPath(ref)
  if (path !== undefined)
    throw new CliError('usage', `${what} works on pages, and "${ref}" is in the Library.`, {
      hint: `A page is named by its path alone: /${pathSegments(path).join('/')}`,
    })
}
