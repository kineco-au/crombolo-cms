/**
 * Content already in a site, written out as seed files (story 163), so an
 * existing site can move to seeds. Text and toggles are written as themselves,
 * a content picker as the page's path where the export carries it, and every
 * other value in its editor's stored shape, which `seed apply` takes back
 * as given. A node keeps its key in the file wherever it is not the one its
 * path would derive, so a round trip names the same nodes.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import {
  currentSchemaState,
  type Db,
  DocumentRepository,
  NodeRepository,
  type NodeRow,
} from '@crombolo/data'
import { seedKey } from './keys.ts'

/** A URL segment from a name: `About us` → `about-us`. */
export const segmentOf = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

const bareKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key))

/** A value as TOML, inline. Nulls are left out: TOML has none. */
export function tomlValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value))
    return `[${value
      .map(tomlValue)
      .filter((v) => v !== undefined)
      .join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const written = tomlValue(v)
      return written === undefined ? [] : [`${bareKey(k)} = ${written}`]
    })
    return `{ ${entries.join(', ')} }`
  }
  return JSON.stringify(String(value))
}

const PICKER = /^umb:\/\/document\/([0-9a-f]{32})$/i
const dashed = (hex: string) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

export interface SeedExportResult {
  written: string[]
}

/** Writes the branches under `roots` as `seed/content/…` files in `siteDir`. */
export async function exportSeed(
  db: Db,
  siteDir: string,
  roots: readonly NodeRow[],
): Promise<SeedExportResult> {
  const state = await currentSchemaState(db)
  const docs = new DocumentRepository(db, {
    nodeState: { version: state.version, revision: state.revision },
  })
  const nodes = new NodeRepository(db)
  const typeAliases = new Map<string, string>()
  const aliasOf = async (typeKey: string) => {
    if (!typeAliases.has(typeKey)) {
      const rows = await db.query<{ alias: string }>(
        `SELECT ct.alias FROM node n JOIN content_type ct ON ct.node_id = n.id WHERE n.unique_id = ?`,
        [normaliseUuid(typeKey)],
      )
      typeAliases.set(typeKey, rows[0] ? String(rows[0].alias) : typeKey)
    }
    return typeAliases.get(typeKey) as string
  }

  // Every node's seed path first, so a picker can name a page by where it lands.
  const pathOf = new Map<string, string>()
  const branch: Array<{ node: NodeRow; path: string; order: number }> = []
  const walk = async (node: NodeRow, parentPath: string | null, order: number) => {
    const taken = new Set(
      branch
        .filter((b) => b.path.startsWith(parentPath ? `${parentPath}/` : ''))
        .map((b) => b.path),
    )
    let segment = segmentOf(node.text ?? node.key)
    for (let n = 2; taken.has(parentPath ? `${parentPath}/${segment}` : segment); n++)
      segment = `${segmentOf(node.text ?? node.key)}-${n}`
    const path = parentPath ? `${parentPath}/${segment}` : segment
    pathOf.set(node.key, path)
    branch.push({ node, path, order })
    const children = await nodes.children(node.id, ObjectTypes.Document, 0, Number.MAX_SAFE_INTEGER)
    for (const [index, child] of children.items.entries()) await walk(child, path, index)
  }
  for (const [index, root] of roots.entries()) await walk(root, null, index)

  const written: string[] = []
  for (const { node, path, order } of branch) {
    const doc = await docs.byKey(node.key)
    if (!doc) continue
    const lines: string[] = [`type = ${JSON.stringify(await aliasOf(doc.contentTypeKey))}`]
    if (normaliseUuid(node.key) !== seedKey(`content/${path}`))
      lines.push(`key = ${JSON.stringify(node.key)}`)
    const invariant = doc.variants.find((v) => v.culture === null)
    if (invariant) lines.push(`name = ${JSON.stringify(invariant.name)}`)
    else
      lines.push(
        `name = ${tomlValue(Object.fromEntries(doc.variants.map((v) => [v.culture as string, v.name])))}`,
      )
    lines.push(`order = ${order}`)
    if (!doc.variants.some((v) => v.state === 'Published' || v.state === 'PublishedPendingChanges'))
      lines.push('published = false')

    const value = (raw: unknown) => {
      if (typeof raw === 'string') {
        const picked = PICKER.exec(raw)
        if (picked) {
          const key = dashed((picked[1] as string).toLowerCase())
          return pathOf.has(key) ? `/${pathOf.get(key)}` : key
        }
      }
      return raw
    }
    const byCulture = new Map<string | null, string[]>()
    for (const v of doc.values) {
      if (v.segment !== null) continue
      const written = tomlValue(value(v.value))
      if (written === undefined) continue
      const list = byCulture.get(v.culture) ?? []
      list.push(`${bareKey(v.alias)} = ${written}`)
      byCulture.set(v.culture, list)
    }
    for (const [culture, entries] of byCulture) {
      lines.push('', culture ? `[values.${bareKey(culture)}]` : '[values]', ...entries)
    }
    const file = join(siteDir, 'seed', 'content', `${path}.toml`)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, `${lines.join('\n')}\n`)
    written.push(`seed/content/${path}.toml`)
  }
  return { written }
}
