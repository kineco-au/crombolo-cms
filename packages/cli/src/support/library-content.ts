/**
 * The `content` commands on a Library path (story 361): what each does for an
 * element or a folder, through the Library operations. The page commands hand
 * over here when they are given `library:/…`.
 */
import { ObjectTypes, SystemNodes } from '@crombolo/core'
import { NodeRepository, type NodeRow, pathSegments, resolveNodeRef } from '@crombolo/data'
import { seedKey, segmentOf } from '@crombolo/server'
import { CliError } from '../errors.ts'
import {
  draftNote,
  findElement,
  findLibraryItem,
  inLibrary,
  isFolder,
  isLibraryTop,
  LIBRARY_SCHEME,
  type LibrarySite,
  libraryActor,
  libraryPath,
  needLibraryVerb,
  needSection,
  refusedInLibrary,
  resolveLibrary,
  withLibrary,
} from './library.ts'
import { sayValues, setsOf, withValuesSet } from './pages.ts'
import type { Io } from './site.ts'

const nameOf = (node: NodeRow | null) => node?.text ?? node?.key ?? ''

interface WriteFlags {
  set?: string[]
  'set-file'?: string[]
  culture?: string
  view?: string
  publish?: boolean
  'dry-run'?: boolean
}

const noView = (flags: { view?: string }) => {
  if (flags.view !== undefined)
    throw new CliError('usage', 'A Library element has no view: leave out --view.')
}

/** The folder a new element goes in, by its names from the top; refused when there is none. */
async function folderAt(site: LibrarySite, parts: readonly string[]): Promise<NodeRow | null> {
  if (parts.length === 0) return null
  const resolved = await resolveNodeRef(site.db, [ObjectTypes.ElementContainer], parts.join('/'))
  if (!resolved.ok || resolved.node.objectType !== ObjectTypes.ElementContainer)
    throw new CliError(
      'refused',
      `Nothing was made: the Library has no folder ${LIBRARY_SCHEME}/${parts.join('/')}.`,
      { hint: "Folders are made in the back office's Library, or by content files." },
    )
  return resolved.node
}

/** `content new library:/…`: an element of an element type, in a folder that exists. */
export async function newElement(
  io: Io,
  ref: string,
  flags: WriteFlags & { type?: string; blueprint?: string },
) {
  noView(flags)
  if (flags.blueprint !== undefined)
    throw new CliError(
      'usage',
      'Blueprints start pages, not Library elements: leave out --blueprint.',
    )
  if (flags.type === undefined)
    throw new CliError('usage', 'Say what kind of element it is: --type.')
  const parts = pathSegments(libraryPath(ref) ?? '')
  const name = parts.pop()
  if (!name)
    throw new CliError(
      'usage',
      'Give the new element a path ending in its name: library:/Menus/Main.',
    )
  needSection(true)
  return withLibrary(async (site) => {
    const type = await site.lookup.typeOf('document', flags.type as string)
    if (!type)
      throw new CliError('not_found', `The site has no element type called "${flags.type}".`, {
        hint: '`crombolo types list` lists them.',
      })
    if (!type.isElement)
      throw new CliError(
        'refused',
        `Nothing was made: "${type.name}" is a page type, and the Library holds elements.`,
        {
          hint: `A page is made with a path alone: crombolo content new /${[...parts, name].join('/')} --type ${type.alias}`,
        },
      )
    if (!type.allowedInLibrary)
      throw new CliError(
        'refused',
        `Nothing was made: "${type.name}" is not one the Library offers.`,
        { hint: `\`crombolo types update ${type.alias} --library\` offers it there.` },
      )
    const parent = await folderAt(site, parts)
    const nodes = new NodeRepository(site.db)
    const taken = await nodes.childrenNamed(
      parent?.id ?? SystemNodes.Root,
      [ObjectTypes.ElementContainer, ObjectTypes.Element],
      name,
    )
    const path = `${LIBRARY_SCHEME}/${[...parts, name].join('/')}`
    if (taken.length > 0)
      throw new CliError('refused', `Nothing was made: there is already "${name}" there.`, {
        hint: `\`crombolo content update ${path}\` changes it.`,
      })
    const derived = seedKey(`library/${[...parts, name].map(segmentOf).join('/')}`)
    const key = (await nodes.byKey(derived)) ? crypto.randomUUID() : derived
    const editors = await site.lookup.editorsOf('document', type)
    const values = await withValuesSet(
      site,
      { key, type, editors },
      [],
      setsOf(flags.set, flags['set-file']),
      [],
      flags.culture ?? null,
    )
    const culture = type.variesByCulture ? (flags.culture ?? site.languages[0] ?? null) : null
    io.say(`  ${flags['dry-run'] ? 'would make' : 'made'}  ${path}  (${type.name})`)
    for (const v of values) io.say(`    ${v.alias}${v.culture ? ` (${v.culture})` : ''}`)
    if (flags['dry-run']) {
      io.say('\nNothing was changed (--dry-run).')
      return { key, name, path, changed: false, published: false }
    }
    const input = {
      key,
      contentTypeKey: type.key,
      componentKey: null,
      parentKey: parent?.key ?? null,
      values,
      variants: [{ culture, segment: null, name }],
    }
    const created = flags.publish
      ? await site.library.createAndPublish(libraryActor(), input, null)
      : await site.library.create(libraryActor(), input)
    if (!created.ok) throw refusedInLibrary(created)
    io.say(flags.publish ? '  published' : draftNote(path))
    return { key, name, path, changed: true, published: flags.publish === true }
  })
}

/** `content update library:/…`: an element's values and name, or a folder's name. */
export async function updateElement(
  io: Io,
  ref: string,
  flags: WriteFlags & { unset?: string[]; name?: string },
) {
  noView(flags)
  needSection(true)
  return withLibrary(async (site) => {
    const found = await findLibraryItem(site, ref)
    const sets = setsOf(flags.set, flags['set-file'])
    if (found.folder) {
      if (sets.length > 0 || flags.unset?.length || flags.publish || flags.name === undefined)
        throw new CliError('refused', `${found.path} is a folder: it has only a name, --name.`)
      io.say(
        `  ${flags['dry-run'] ? 'would rename' : 'renamed'}  ${found.path}  to "${flags.name}"`,
      )
      if (flags['dry-run']) {
        io.say('\nNothing was changed (--dry-run).')
        return { key: found.node.key, path: found.path, changed: false, published: false }
      }
      const renamed = await site.library.renameFolder(libraryActor(), found.node.key, flags.name)
      if (!renamed.ok) throw refusedInLibrary(renamed)
      return { key: found.node.key, path: found.path, changed: true, published: false }
    }
    const { doc, type } = found
    if (flags.culture && !type.variesByCulture)
      throw new CliError(
        'refused',
        `Nothing was changed: "${type.name}" elements are the same in every language.`,
      )
    const values = await withValuesSet(
      site,
      { key: doc.key, type, editors: found.editors },
      doc.values,
      sets,
      flags.unset ?? [],
      flags.culture ?? null,
    )
    const culture = type.variesByCulture ? (flags.culture ?? site.languages[0] ?? null) : null
    const variants = doc.variants.map(({ culture, segment, name }) => ({ culture, segment, name }))
    if (flags.name !== undefined) {
      const at = variants.findIndex((v) => v.culture === culture && v.segment === null)
      if (at >= 0) variants[at] = { culture, segment: null, name: flags.name }
      else variants.push({ culture, segment: null, name: flags.name })
    }
    io.say(`  ${flags['dry-run'] ? 'would save' : 'saved'}  ${found.path}`)
    for (const [alias] of sets) io.say(`    ${alias}`)
    for (const alias of flags.unset ?? []) io.say(`    no ${alias}`)
    if (flags.name !== undefined) io.say(`    named "${flags.name}"`)
    if (flags['dry-run']) {
      io.say('\nNothing was changed (--dry-run).')
      return { key: doc.key, path: found.path, changed: false, published: false }
    }
    const input = {
      key: doc.key,
      contentTypeKey: doc.contentTypeKey,
      componentKey: null,
      parentKey: doc.parentKey,
      values,
      variants,
    }
    const saved = flags.publish
      ? await site.library.saveAndPublish(libraryActor(), doc.key, input, null)
      : await site.library.save(libraryActor(), doc.key, input)
    if (!saved.ok) throw refusedInLibrary(saved)
    io.say(flags.publish ? '  published' : draftNote(found.path))
    return { key: doc.key, path: found.path, changed: true, published: flags.publish === true }
  })
}

const STATES: Record<string, string> = {
  Draft: 'a draft',
  Published: 'published',
  PublishedPendingChanges: 'published, with changes not published yet',
  NotCreated: 'not made in this language',
}

/** `content show library:/…`: an element as a page is shown, or what a folder holds. */
export async function showLibraryItem(io: Io, ref: string) {
  needSection(true)
  needLibraryVerb('read')
  return withLibrary(async (site) => {
    const found = await findLibraryItem(site, ref)
    if (found.folder) {
      const inside = await new NodeRepository(site.db).childrenOf(
        found.node.id,
        [ObjectTypes.ElementContainer, ObjectTypes.Element],
        0,
        Number.MAX_SAFE_INTEGER,
      )
      const items = inside.items.map((node) => ({
        key: node.key,
        name: nameOf(node),
        folder: isFolder(node),
      }))
      io.say(`${found.path}  (a Library folder)`)
      io.say(`  key      ${found.node.key}`)
      for (const item of items) io.say(`  ${item.folder ? 'folder ' : '       '} ${item.name}`)
      if (items.length === 0) io.say('  Nothing is in it.')
      return { key: found.node.key, path: found.path, folder: true, items }
    }
    const { doc, type } = found
    const values = []
    for (const v of doc.values) {
      if (v.segment !== null) continue
      const editor = found.editors.get(v.alias)?.editor ?? ''
      values.push({
        property: v.alias,
        culture: v.culture,
        value: await site.reader.shorthand(editor, v.value),
      })
    }
    io.say(`${found.path}  (${type.name}, ${type.alias})`)
    io.say(`  key      ${doc.key}`)
    for (const variant of doc.variants)
      io.say(
        `  ${variant.culture ? `${variant.culture.padEnd(8)} ` : ''}"${variant.name}", ${STATES[variant.state] ?? variant.state}`,
      )
    sayValues(io, values)
    return {
      key: doc.key,
      path: found.path,
      type: type.alias,
      folder: false,
      variants: doc.variants.map((v) => ({ culture: v.culture, name: v.name, state: v.state })),
      values,
    }
  })
}

/** Each Library item named, once, in the order given; the top refused. */
async function libraryItems(site: LibrarySite, refs: readonly string[]): Promise<NodeRow[]> {
  const out: NodeRow[] = []
  for (const ref of refs) {
    const node = await resolveLibrary(site.db, ref)
    if (!node)
      throw new CliError('usage', 'library:/ is the top of the Library: name an item in it.')
    if (!out.some((seen) => seen.id === node.id)) out.push(node)
  }
  return out
}

/** The folder `--to` names in the Library, or null for its top; a page path refused. */
async function libraryPlace(site: LibrarySite, to: string): Promise<NodeRow | null> {
  if (!(await inLibrary(site.db, to)))
    throw new CliError(
      'usage',
      `--to "${to}" is a page path: Library items go into a Library folder.`,
      { hint: 'Name one as library:/<folder>, or library:/ for the top of the Library.' },
    )
  if (isLibraryTop(to)) return null
  const node = await resolveLibrary(site.db, to)
  if (node && !isFolder(node))
    throw new CliError('refused', `--to names an element: Library items go into folders.`)
  return node
}

const placeOf = (target: NodeRow | null) =>
  target ? { key: target.key, name: nameOf(target) } : null

/** `content move library:/… --to library:/…`: elements and folders, with what folders hold. */
export async function moveLibrary(io: Io, refs: readonly string[], to: string, dryRun: boolean) {
  needSection(true)
  return withLibrary(async (site) => {
    const items = await libraryItems(site, refs)
    const target = await libraryPlace(site, to)
    const parentId = target?.id ?? SystemNodes.Root
    for (const node of items) {
      needLibraryVerb(isFolder(node) ? 'moveFolder' : 'move')
      if (target && (target.id === node.id || `${target.path},`.startsWith(`${node.path},`)))
        throw new CliError('refused', `Nothing was moved: ${nameOf(node)} cannot go inside itself.`)
    }
    const where = target ? `under ${nameOf(target)}` : 'to the top of the Library'
    const out: Array<{ key: string; name: string; changed: boolean }> = []
    for (const node of items) {
      const already = node.parentId === parentId && !node.trashed
      if (!already && !dryRun) {
        const moved = isFolder(node)
          ? await site.library.moveFolder(libraryActor(), node.key, target?.key ?? null)
          : await site.library.move(libraryActor(), node.key, target?.key ?? null)
        if (!moved.ok) throw refusedInLibrary(moved)
      }
      out.push({ key: node.key, name: nameOf(node), changed: !already })
      io.say(
        `  ${already ? `already ${where}:` : dryRun ? 'would move' : 'moved'}  ${nameOf(node)}`,
      )
    }
    const count = out.filter((item) => item.changed).length
    io.say(`\n${count} Library item(s) ${dryRun ? 'would be moved' : 'moved'} ${where}.`)
    return {
      items: out,
      changed: !dryRun && count > 0,
      target: placeOf(target),
    }
  })
}

/** `content delete library:/…`: elements and folders to the Library's recycle bin. */
export async function trashLibrary(io: Io, refs: readonly string[], dryRun: boolean) {
  needSection(true)
  return withLibrary(async (site) => {
    const items = await libraryItems(site, refs)
    for (const node of items) needLibraryVerb(isFolder(node) ? 'trashFolder' : 'trash')
    const out: Array<{ key: string; name: string; changed: boolean }> = []
    for (const node of items) {
      if (!node.trashed && !dryRun) {
        const trashed = isFolder(node)
          ? await site.library.trashFolder(libraryActor(), node.key)
          : await site.library.trash(libraryActor(), node.key)
        if (!trashed.ok) throw refusedInLibrary(trashed)
      }
      out.push({ key: node.key, name: nameOf(node), changed: !node.trashed })
      io.say(
        `  ${node.trashed ? 'already in the recycle bin:' : dryRun ? 'would move to the recycle bin' : 'moved to the recycle bin'}  ${nameOf(node)}`,
      )
    }
    return { items: out, changed: !dryRun && out.some((item) => item.changed) }
  })
}

/** `content copy library:/… --to library:/…`: an element, as a draft with a free name. */
export async function copyElement(io: Io, ref: string, to: string, dryRun: boolean) {
  needSection(true)
  return withLibrary(async (site) => {
    const element = await findElement(site, ref).catch(async (error) => {
      if (error instanceof CliError && error.kind === 'refused')
        throw new CliError('refused', 'A folder is not copied: copy the elements in it.')
      throw error
    })
    const target = await libraryPlace(site, to)
    const where = target ? `under ${nameOf(target)}` : 'at the top of the Library'
    io.say(`  ${dryRun ? 'would copy' : 'copied'}  ${nameOf(element.node)} ${where}`)
    if (dryRun) {
      needLibraryVerb('copy')
      return { key: null, name: nameOf(element.node), target: placeOf(target), changed: false }
    }
    const copied = await site.library.copy(libraryActor(), element.doc.key, target?.key ?? null)
    if (!copied.ok) throw refusedInLibrary(copied)
    return {
      key: copied.key,
      name: nameOf(element.node),
      target: placeOf(target),
      changed: true,
    }
  })
}

/** `content publish|unpublish library:/…`: one element, now; a menu changes the site once published. */
export async function publishElement(
  io: Io,
  publishing: boolean,
  ref: string,
  flags: { descendants: boolean; culture: string[]; at?: string; until?: string },
) {
  if (flags.descendants)
    throw new CliError('usage', 'A Library element has nothing below it: leave out --descendants.')
  if (flags.at !== undefined || flags.until !== undefined)
    throw new CliError(
      'usage',
      `A Library element is ${publishing ? 'published' : 'unpublished'} now from here: leave out --at and --until.`,
      { hint: "Its Publish dialog in the back office's Library schedules it." },
    )
  needSection(true)
  return withLibrary(async (site) => {
    const element = await findLibraryItem(site, ref)
    if (element.folder)
      throw new CliError(
        'refused',
        `${element.path} is a folder: ${publishing ? 'publish' : 'unpublish'} the elements in it.`,
      )
    const cultures = flags.culture.length > 0 ? flags.culture : null
    const result = publishing
      ? await site.library.publish(libraryActor(), element.doc.key, cultures)
      : await site.library.unpublish(libraryActor(), element.doc.key, cultures)
    if (!result.ok) throw refusedInLibrary(result)
    const name = nameOf(element.node)
    io.say(
      `  ${publishing ? 'published' : 'unpublished'} ${element.path}${cultures ? ` in ${cultures.join(', ')}` : ''}`,
    )
    return {
      pages: [{ key: element.doc.key, name, changed: true }],
      scheduled: false,
      cultures: flags.culture,
    }
  })
}

/** The Library place `find --under` or `--parent` names, by key; undefined for the top. */
export async function libraryScope(site: { db: LibrarySite['db'] }, ref: string | undefined) {
  if (ref === undefined || isLibraryTop(ref)) return undefined
  const node = await resolveLibrary(site.db, ref)
  return node?.key
}
