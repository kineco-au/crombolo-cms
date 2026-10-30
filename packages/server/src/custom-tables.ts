/**
 * The chains of custom tables (stories 062, 189): the site's own, from
 * `database.tables` in its config, then each wired bundle's that declares
 * tables, in the order `bundles` lists them. Worked out once from the config
 * and the packages, and run after core's.
 *
 * Only a node that owns the database applies them or provisions their places.
 * Every node opens the site's, because named queries run wherever pages render.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BundlePackage, discoverBundles } from '@crombolo/backoffice-host/registry'
import {
  type CompiledTables,
  compileTables,
  type Db,
  type Migration,
  type MigrationPlan,
  migrate,
  type OwnerSlot,
  openOwner,
  type PlannedStep,
  pendingMigrations,
  planUpgrade,
  provisionOwner,
  readLedger,
  readState,
  recordedOwner,
  SITE_OWNER,
  type TablesDatabase,
  tablesDatabase,
  tablesPlan,
} from '@crombolo/data'
import { anonymiseProblems } from './anonymise-rules.ts'
import { type ServerBundle, validateServerBundles } from './bundles.ts'
import { type CromboloConfig, VERSION } from './config.ts'

/** One owner's chain, with what it is called and where it runs. */
export interface TablesChain {
  /** `site`, or the bundle's id. */
  id: string
  name: string
  compiled: CompiledTables
  plan: MigrationPlan
  slot: OwnerSlot
}

/** The site's own version, from its package.json, which its steps may not run past. */
function siteVersion(siteDir: string | undefined): string | undefined {
  if (!siteDir) return undefined
  const file = join(siteDir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    const version = (JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

function chainOf(id: string, name: string, compiled: CompiledTables): TablesChain {
  const slot: OwnerSlot = {}
  return { id, name, compiled, plan: tablesPlan(compiled, slot), slot }
}

/** Why the site's own tables cannot be used: every reason, at once. */
export function siteTablesProblems(config: Pick<CromboloConfig, 'database' | 'siteDir'>): string[] {
  const tables = config.database?.tables
  const rules = config.database?.anonymise
  if (!tables)
    return rules === undefined
      ? []
      : ['database.anonymise is given, and there is no database.tables for it to describe.']
  if (tables.id !== SITE_OWNER)
    return [`database.tables is "${tables.id}"'s; the site's are made with defineSiteTables`]
  const compiled = compileTables(tables, siteVersion(config.siteDir))
  return [
    ...compiled.problems.map((problem) => `The site's tables: ${problem}.`),
    ...(rules === undefined || compiled.problems.length > 0
      ? []
      : anonymiseProblems(rules, compiled.schema).map((problem) => `The site's ${problem}.`)),
  ]
}

/**
 * The site's chain, then those of every wired bundle that declares tables, in
 * wiring order. Throws when a declaration is invalid; boot reports the reasons
 * first, from `siteTablesProblems` and `validateServerBundles`.
 */
export function tablesChains(
  config: Pick<CromboloConfig, 'database' | 'siteDir' | 'siteName'>,
  bundles: readonly ServerBundle[],
  packages: readonly BundlePackage[],
): TablesChain[] {
  const chains: TablesChain[] = []
  const site = config.database?.tables
  if (site)
    chains.push(
      chainOf(SITE_OWNER, config.siteName, compileTables(site, siteVersion(config.siteDir))),
    )
  for (const bundle of bundles) {
    if (!bundle.tables) continue
    const owner = packages.find((pkg) => pkg.id === bundle.id)
    chains.push(
      chainOf(bundle.id, owner?.name ?? bundle.id, compileTables(bundle.tables, owner?.version)),
    )
  }
  return chains
}

/** The site's tables or bundles cannot be used: every reason, at once. */
export class BundleConfigurationError extends Error {
  constructor(readonly problems: string[]) {
    super(`The configured tables and bundles cannot be used:\n- ${problems.join('\n- ')}`)
  }
}

/**
 * The chains for a site's configuration, discovering its packages and checking
 * the declarations exactly as boot checks them, so a command off the server
 * refuses what the server would.
 */
export function tablesChainsFor(
  config: Pick<CromboloConfig, 'bundles' | 'siteDir' | 'database' | 'siteName'>,
): TablesChain[] {
  const packages = config.bundles.length > 0 ? discoverBundles(config.siteDir).bundles : []
  const problems = [
    ...siteTablesProblems(config),
    ...(config.bundles.length > 0 ? validateServerBundles(config.bundles, packages, VERSION) : []),
  ]
  if (problems.length > 0) throw new BundleConfigurationError(problems)
  return tablesChains(config, config.bundles, packages)
}

type OwnerConfig = Pick<CromboloConfig, 'siteName' | 'sqliteFile'>

/**
 * Finds each chain's place, creating it where `provision` (a node that owns the
 * database), and opens the connection its steps run on. A place never
 * provisioned is left empty on a node that may not provision.
 */
export async function openTables(
  db: Db,
  config: OwnerConfig,
  chains: readonly TablesChain[],
  options: { provision: boolean },
): Promise<void> {
  for (const chain of chains) {
    if (chain.slot.place) continue
    const place = options.provision
      ? await provisionOwner(db, config, chain.id)
      : await recordedOwner(db, config, chain.id)
    if (!place) continue
    chain.slot.place = place
    chain.slot.db = await openOwner(db, place)
  }
}

/** Closes the owners' own SQLite connections; a Postgres one only borrows the pool. */
export async function closeTables(chains: readonly TablesChain[]): Promise<void> {
  for (const chain of chains) {
    const owned = chain.slot.db
    if (owned && chain.slot.place?.file !== ':memory:') await owned.close()
    chain.slot.db = undefined
    chain.slot.place = undefined
  }
}

/** The owner's tables are not set up on this database. */
export class TablesNotReadyError extends Error {
  constructor(readonly owner: string) {
    super(
      `The ${owner === SITE_OWNER ? "site's own tables are" : `bundle "${owner}"'s tables are`} not set up on this database yet. Start the node that owns the database, or run \`crombolo upgrade\`.`,
    )
  }
}

/** The Kysely handle on a chain's tables, on the connection that reaches only them. */
export function databaseFor(chain: TablesChain): TablesDatabase {
  const owned = chain.slot.db
  if (!chain.slot.place || !owned) throw new TablesNotReadyError(chain.id)
  return tablesDatabase(owned, chain.compiled.schema) as TablesDatabase
}

export interface TablesPending {
  id: string
  name: string
  state: string
  pending: Migration[]
}

/** What each chain still has to run. Throws `UpgradeStateError`, naming the owner, when one is ahead. */
export async function pendingTablesSteps(
  db: Db,
  chains: readonly TablesChain[],
): Promise<TablesPending[]> {
  const out: TablesPending[] = []
  for (const chain of chains)
    out.push({
      id: chain.id,
      name: chain.name,
      state: await readState(db, chain.plan),
      pending: await pendingMigrations(db, chain.plan),
    })
  return out
}

/** Provisions each chain's place and runs its pending steps, in order, after core's. */
export async function migrateTables(
  db: Db,
  config: OwnerConfig,
  chains: readonly TablesChain[],
  options: { by?: string } = {},
): Promise<{ id: string; applied: string[] }[]> {
  await openTables(db, config, chains, { provision: true })
  const out: { id: string; applied: string[] }[] = []
  for (const chain of chains) {
    const result = await migrate(db, chain.plan, { by: options.by })
    out.push({ id: chain.id, applied: result.applied })
  }
  return out
}

/** What each chain would run, without running it. */
export async function planTablesUpgrades(
  db: Db,
  chains: readonly TablesChain[],
): Promise<{ id: string; name: string; steps: PlannedStep[] }[]> {
  const out: { id: string; name: string; steps: PlannedStep[] }[] = []
  for (const chain of chains)
    out.push({ id: chain.id, name: chain.name, steps: await planUpgrade(db, chain.plan) })
  return out
}

export interface TablesReport {
  id: string
  name: string
  pending: { name: string; kind: string; release: string | null }[]
  /** What has run here since the owner was last purged, oldest first. */
  applied: { name: string; kind: string; release: string | null; appliedAt: string }[]
}

/** Each chain's steps, applied and pending, as the Changes dashboard shows them. */
export async function tablesReport(
  db: Db,
  chains: readonly TablesChain[],
): Promise<TablesReport[]> {
  const ledger = await readLedger(db)
  const out: TablesReport[] = []
  for (const chain of chains) {
    const rows = ledger.filter((row) => row.bundle === chain.id)
    const purged = rows.map((row) => row.kind).lastIndexOf('purge')
    const releases = new Map(chain.compiled.steps.map((step) => [step.name, step.release]))
    out.push({
      id: chain.id,
      name: chain.name,
      pending: (await pendingMigrations(db, chain.plan)).map((step) => ({
        name: step.name,
        kind: step.kind ?? 'expand',
        release: step.release ?? null,
      })),
      applied: rows
        .slice(purged + 1)
        .filter((row) => row.kind === 'expand' || row.kind === 'contract')
        .map((row) => ({
          name: row.name,
          kind: row.kind,
          release: releases.get(row.name) ?? null,
          appliedAt: row.appliedAt,
        })),
    })
  }
  return out
}
