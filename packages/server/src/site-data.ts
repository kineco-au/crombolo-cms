/**
 * The site's and bundles' own tables in a site file (story 189): read out
 * through each owner's handle for `export --with-site-data`, and written back
 * when a file carrying them is applied. docs/content-transfer.md, "Site data".
 */
import { discoverBundles } from '@crombolo/backoffice-host/registry'
import {
  type ColumnSpec,
  type Db,
  openOwner,
  ownerTablesIn,
  recordedOwner,
  SITE_OWNER,
} from '@crombolo/data'
import {
  type AnonymiseRules,
  type SanitiseSiteData,
  type SiteDataRow,
  type SiteDataTable,
  siteDataName,
} from '@crombolo/transfer'
import { emptyValue } from './anonymise-rules.ts'
import type { CromboloConfig } from './config.ts'
import { closeTables, databaseFor, type TablesChain, tablesChainsFor } from './custom-tables.ts'

type SiteDataConfig = Pick<
  CromboloConfig,
  'bundles' | 'siteDir' | 'database' | 'siteName' | 'sqliteFile'
>

/**
 * The chains whose tables exist here, each opened, with the tables it has.
 * An owner never set up is left out rather than created.
 */
async function openPresent(
  db: Db,
  config: SiteDataConfig,
): Promise<{ chains: TablesChain[]; present: Map<string, Set<string>> }> {
  const chains = tablesChainsFor(config)
  const present = new Map<string, Set<string>>()
  for (const chain of chains) {
    const place = await recordedOwner(db, config, chain.id)
    if (!place) continue
    const tables = await ownerTablesIn(db, place)
    if (tables.length === 0) continue
    chain.slot.place = place
    chain.slot.db = await openOwner(db, place)
    present.set(chain.id, new Set(tables))
  }
  return { chains, present }
}

/** Each owner's anonymise rules: the site's from its config, a bundle's from its package.json. */
function rulesFor(config: SiteDataConfig): Record<string, AnonymiseRules | undefined> {
  const rules: Record<string, AnonymiseRules | undefined> = {
    [SITE_OWNER]: config.database?.anonymise,
  }
  if (config.bundles.length > 0)
    for (const pkg of discoverBundles(config.siteDir).bundles)
      if (pkg.field.anonymise) rules[pkg.id] = pkg.field.anonymise
  return rules
}

/** Every row of every owner's tables, in declaration order, with what anonymising them needs. */
export async function readSiteData(db: Db, config: SiteDataConfig): Promise<SanitiseSiteData> {
  const { chains, present } = await openPresent(db, config)
  const specs = new Map<string, ColumnSpec>()
  const tables: SiteDataTable[] = []
  try {
    for (const chain of chains) {
      const here = present.get(chain.id)
      if (!here) continue
      const handle = databaseFor(chain) as unknown as {
        selectFrom: (table: string) => {
          selectAll: () => { execute: () => Promise<SiteDataRow[]> }
        }
      }
      for (const [table, declared] of chain.compiled.schema.tables) {
        if (!here.has(table)) continue
        for (const [column, resolved] of declared.columns)
          specs.set(`${chain.id}\0${table}\0${column}`, resolved.spec)
        tables.push({
          owner: chain.id,
          table,
          rows: await handle.selectFrom(table).selectAll().execute(),
        })
      }
    }
  } finally {
    await closeTables(chains)
  }
  return {
    tables,
    rules: rulesFor(config),
    empty: (owner, table, column) => {
      const spec = specs.get(`${owner}\0${table}\0${column}`)
      return spec ? emptyValue(spec) : null
    },
  }
}

/** A value read from the file as the column's handle writes it. */
function writable(spec: ColumnSpec, value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (spec.type === 'timestamp' && typeof value === 'string') return new Date(value)
  // Stringified here, so a JSON string or number is stored as JSON rather than as itself.
  if (spec.type === 'json') return JSON.stringify(value)
  return value
}

export interface SiteDataApplied {
  /** Tables written, and the rows in them. */
  tables: number
  rows: number
  /** What the file carries and this site has no place for: owners, tables and columns. */
  skipped: string[]
  /** Owners whose tables could not be written, each with why; their tables are as they were. */
  failed: string[]
}

type Writer = {
  deleteFrom: (table: string) => { execute: () => Promise<unknown> }
  insertInto: (table: string) => {
    values: (row: SiteDataRow) => { execute: () => Promise<unknown> }
  }
}

/**
 * Replaces each owner's tables with the file's rows, one owner per
 * transaction: every table of an owner the file carries is emptied, children
 * first, then filled, parents first. An owner or table this site lacks is
 * skipped and named, as is a column it does not declare.
 */
export async function applySiteData(
  db: Db,
  config: SiteDataConfig,
  carried: readonly SiteDataTable[],
): Promise<SiteDataApplied> {
  const result: SiteDataApplied = { tables: 0, rows: 0, skipped: [], failed: [] }
  const { chains, present } = await openPresent(db, config)
  try {
    const byOwner = new Map<string, Map<string, SiteDataRow[]>>()
    for (const t of carried) {
      const tables = byOwner.get(t.owner) ?? new Map<string, SiteDataRow[]>()
      tables.set(t.table, t.rows)
      byOwner.set(t.owner, tables)
    }
    for (const [owner, tables] of byOwner) {
      const chain = chains.find((c) => c.id === owner)
      const here = present.get(owner)
      if (!chain || !here) {
        result.skipped.push(owner)
        continue
      }
      const declared = [...chain.compiled.schema.tables.values()].filter((t) => here.has(t.name))
      for (const table of tables.keys())
        if (!declared.some((t) => t.name === table)) result.skipped.push(siteDataName(owner, table))
      const fills = declared.flatMap((t) => {
        const rows = tables.get(t.name)
        if (!rows) return []
        const unknown = new Set<string>()
        const values = rows.map((row) => {
          const out: SiteDataRow = {}
          for (const [column, value] of Object.entries(row)) {
            const spec = t.columns.get(column)?.spec
            if (spec) out[column] = writable(spec, value)
            else unknown.add(column)
          }
          return out
        })
        for (const column of unknown)
          result.skipped.push(`${siteDataName(owner, t.name)}.${column}`)
        return [{ table: t.name, rows: values }]
      })
      try {
        await databaseFor(chain)
          .transaction()
          .execute(async (trx) => {
            const k = trx as unknown as Writer
            for (const t of [...declared].reverse()) await k.deleteFrom(t.name).execute()
            // One row at a time: SQLite cannot default a column in a multi-row insert.
            for (const fill of fills)
              for (const row of fill.rows) await k.insertInto(fill.table).values(row).execute()
          })
        result.tables += fills.length
        result.rows += fills.reduce((total, fill) => total + fill.rows.length, 0)
      } catch (error) {
        result.failed.push(`${owner}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    await closeTables(chains)
  }
  return result
}
