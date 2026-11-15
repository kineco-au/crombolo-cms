/**
 * Blueprints from the command line (story 358): a page's values saved as a
 * starting point for new pages of its type, through the blueprint port the
 * back office's handlers use. `content blueprint` and `content new --blueprint`
 * share it.
 */
import type { BlueprintPort } from '@crombolo/api-management/domain'
import { normaliseUuid, ObjectTypes, type TreeItem } from '@crombolo/core'
import { currentSchemaState, looksLikeKey, NodeRepository } from '@crombolo/data'
import { createBlueprintPort } from '@crombolo/server'
import { CliError } from '../errors.ts'
import { type PageSite, withPages } from './pages.ts'

export interface BlueprintSite {
  site: PageSite
  port: BlueprintPort
}

export interface FoundBlueprint {
  key: string
  name: string
  contentTypeKey: string
  /** The folder it is in, by name, `Landing pages/Campaigns`; empty at the top. */
  folder: string
}

/** The site's database, its page operations and the blueprint port, for one command. */
export function withBlueprints<T>(work: (blueprints: BlueprintSite) => Promise<T>): Promise<T> {
  return withPages(async (site) => {
    const state = await currentSchemaState(site.db)
    const port = createBlueprintPort(site.db, {
      nodeState: { version: state.version, revision: state.revision },
    })
    return work({ site, port })
  })
}

const ALL = { skip: 0, take: 100_000 }

/** Every blueprint, in the order the Settings tree shows them, with the folder each is in. */
export async function allBlueprints(port: BlueprintPort): Promise<FoundBlueprint[]> {
  const found: FoundBlueprint[] = []
  const walk = async (items: TreeItem[], folder: string) => {
    for (const item of items) {
      if (item.isFolder) {
        const inside = folder ? `${folder}/${item.name}` : item.name
        await walk((await port.treeChildren(item.key, ALL)).items, inside)
      } else
        found.push({
          key: normaliseUuid(item.key),
          name: item.name,
          contentTypeKey: normaliseUuid(item.contentTypeKey ?? ''),
          folder,
        })
    }
  }
  await walk((await port.treeRoot(ALL)).items, '')
  return found
}

/**
 * The blueprint a key or a name gives: a name within `typeKey` when one is
 * given, else across every type. Refused, with their keys, when a name gives
 * more than one.
 */
export async function findBlueprint(
  port: BlueprintPort,
  ref: string,
  typeKey?: string,
): Promise<FoundBlueprint> {
  const all = await allBlueprints(port)
  if (looksLikeKey(ref)) {
    const byKey = all.find((b) => b.key === normaliseUuid(ref))
    if (byKey) return byKey
  }
  const named = typeKey
    ? (await port.forContentType(typeKey, ALL)).items.filter((b) => b.name === ref)
    : all.filter((b) => b.name === ref)
  const matches = named.flatMap((b) => all.filter((a) => a.key === normaliseUuid(b.key)))
  if (matches.length === 1) return matches[0] as FoundBlueprint
  if (matches.length === 0)
    throw new CliError('not_found', `There is no blueprint called "${ref}".`, {
      hint: '`crombolo content blueprint list` lists them.',
    })
  throw new CliError(
    'refused',
    `${matches.length} blueprints are called "${ref}": name one by its key.`,
    { details: matches.map((b) => (b.folder ? `${b.key}  in ${b.folder}` : b.key)) },
  )
}

/** A page's place for a permission check: its ancestors' keys then its own, root first. */
export async function chainOf(
  site: PageSite,
  key: string,
): Promise<{ chain: string[]; trashed: boolean }> {
  const nodes = new NodeRepository(site.db)
  const node = await nodes.byKey(key)
  if (!node) return { chain: [], trashed: false }
  const ids = node.path
    .split(',')
    .map(Number)
    .filter((id) => id > 0)
  const byId = new Map((await nodes.byIds(ids)).map((row) => [row.id, row]))
  return {
    chain: ids.flatMap((id) => {
      const row = byId.get(id)
      return row && row.objectType === ObjectTypes.Document ? [row.key] : []
    }),
    trashed: node.trashed,
  }
}
