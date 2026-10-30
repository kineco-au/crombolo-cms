/**
 * The site's and bundles' own tables in a site file (story 189): one file per
 * table at `data/<owner>/<table>.json`, a JSON array of rows, always sealed as
 * people are (`seal.ts`). The manifest says which tables and how many rows,
 * never what they hold. docs/content-transfer.md, "Site data".
 */
import { openBytes, type Seal, sealBytes } from './seal.ts'

/** What an anonymised export does with a column. */
export type AnonymiseColumn = 'member' | 'email' | 'scrub'

/** A table's rule: copied as it is, or with the listed columns rewritten. Unlisted tables travel empty. */
export type AnonymiseTable = 'keep' | Readonly<Record<string, AnonymiseColumn>>

export type AnonymiseRules = Readonly<Record<string, AnonymiseTable>>

export const ANONYMISE_COLUMNS: readonly AnonymiseColumn[] = ['member', 'email', 'scrub']

export type SiteDataRow = Record<string, unknown>

/** One owner's table: `site`, or a bundle's id. */
export interface SiteDataTable {
  owner: string
  table: string
  rows: SiteDataRow[]
}

/** What the manifest says of the site data: tables and row counts, never what they hold. */
export interface SiteDataBlock {
  tables: Array<{ owner: string; table: string; rows: number }>
  /** Every sealed file, in path order. */
  paths: string[]
}

export const SITE_DATA_DIR = 'data'

const OWNER = /^(?:site|[a-z][a-z0-9-]{1,38})$/
const TABLE = /^[a-z][a-z0-9_]*$/

export const siteDataPath = (owner: string, table: string): string =>
  `${SITE_DATA_DIR}/${owner}/${table}.json`

/** `owner.table`, as a person reads which table is meant. */
export const siteDataName = (owner: string, table: string): string => `${owner}.${table}`

function parsePath(path: string): { owner: string; table: string } | undefined {
  const parts = path.split('/')
  if (parts.length !== 3 || parts[0] !== SITE_DATA_DIR) return undefined
  const [, owner, file] = parts as [string, string, string]
  const table = file.endsWith('.json') ? file.slice(0, -'.json'.length) : ''
  return OWNER.test(owner) && TABLE.test(table) ? { owner, table } : undefined
}

/** The tables sealed under the bundle's seal: the files, and the manifest's block. */
export function sealSiteData(
  tables: readonly SiteDataTable[],
  { key }: Seal,
): { files: Array<{ path: string; bytes: Uint8Array }>; block: SiteDataBlock } {
  const files = tables
    .map((t) => {
      const path = siteDataPath(t.owner, t.table)
      return { path, bytes: sealBytes(key, path, Buffer.from(`${JSON.stringify(t.rows)}\n`)) }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return {
    files,
    block: {
      tables: tables.map((t) => ({ owner: t.owner, table: t.table, rows: t.rows.length })),
      paths: files.map((f) => f.path),
    },
  }
}

/** The tables opened with the bundle's key, in the order the block lists them. */
export function openSiteData(
  block: SiteDataBlock,
  files: ReadonlyMap<string, Uint8Array>,
  key: Buffer,
): SiteDataTable[] {
  return block.tables.map(({ owner, table, rows: count }) => {
    const path = siteDataPath(owner, table)
    const sealed = files.get(path)
    if (!sealed) throw new Error(`${path} is missing from the bundle's site data.`)
    const rows = JSON.parse(openBytes(key, path, sealed).toString('utf8')) as unknown
    if (!Array.isArray(rows) || rows.length !== count)
      throw new Error("The bundle's site data does not match the counts its manifest gives.")
    return { owner, table, rows: rows as SiteDataRow[] }
  })
}

/** A manifest's site data block read without trusting it: undefined when absent or malformed. Pure. */
export function parseSiteDataBlock(raw: unknown): SiteDataBlock | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const block = raw as Record<string, unknown>
  if (!Array.isArray(block.tables)) return undefined
  const tables: SiteDataBlock['tables'] = []
  const seen = new Set<string>()
  for (const entry of block.tables as unknown[]) {
    const t = entry as Record<string, unknown> | null
    if (!t || typeof t.owner !== 'string' || typeof t.table !== 'string') return undefined
    const path = siteDataPath(t.owner, t.table)
    if (!parsePath(path) || seen.has(path)) return undefined
    if (!Number.isInteger(t.rows) || (t.rows as number) < 0) return undefined
    seen.add(path)
    tables.push({ owner: t.owner, table: t.table, rows: t.rows as number })
  }
  return { tables, paths: [...seen].sort() }
}
