/**
 * An owner's compiled steps as a migration chain, run by the same `migrate`,
 * under the same lock and into the same ledger as core's — only its state key,
 * its ledger rows' `bundle` and where its steps run differ (story 189). And
 * purging one: dropping its schema or file whole, because a purged bundle is
 * one the site no longer wires.
 */
import { existsSync, rmSync } from 'node:fs'
import type { Kysely } from 'kysely'
import type { Db } from '../database.ts'
import { deleteKeyValue, type Migration, MigrationPlan, recordInLedger } from '../migrations.ts'
import { renderStep } from './ddl.ts'
import { tablesDatabase } from './handle.ts'
import { asOwner, forgetOwner, type OwnerPlace, openOwner } from './owners.ts'
import type { CompiledStep, CompiledTables } from './schema.ts'

/**
 * Where an owner's steps run, filled once its place is known: at boot, after
 * the database is connected and the place provisioned.
 */
export interface OwnerSlot {
  place?: OwnerPlace
  /** SQLite: the owner's own connection. */
  db?: Db
}

function migrationOf(step: CompiledStep): Migration {
  return {
    from: step.from,
    to: step.to,
    name: step.name,
    kind: step.kind,
    release: step.release,
    contracts: step.contracts,
    checksum: step.checksum,
    async up(db) {
      for (const statement of renderStep(db.dialect, step)) await db.exec(statement)
    },
    backfill: step.backfill
      ? (db) =>
          (step.backfill as NonNullable<CompiledStep['backfill']>)(tablesDatabase(db, step.after))
      : undefined,
  }
}

/** The chain `migrate` walks. Throws when the declaration has problems: compile first. */
export function tablesPlan(compiled: CompiledTables, slot: OwnerSlot = {}): MigrationPlan {
  if (compiled.problems.length > 0)
    throw new Error(
      `The tables of "${compiled.id}" cannot be planned:\n- ${compiled.problems.join('\n- ')}`,
    )
  return new MigrationPlan(compiled.steps.map(migrationOf), {
    stateKey: compiled.stateKey,
    initialState: compiled.initialState,
    bundle: compiled.id,
    runStep: (tx, step) => {
      if (!slot.place) throw new Error(`The tables of "${compiled.id}" have no place yet.`)
      return asOwner(tx, slot.place, slot.db, step)
    },
  })
}

/**
 * Creates an owner's tables directly, step by step, without its ledger or its
 * state. Only for proving what core's own migrations do around them: an install
 * is always `migrate`.
 */
export async function applyStepsUnledgered(owned: Db, compiled: CompiledTables): Promise<void> {
  for (const migration of tablesPlan(compiled).migrations)
    await owned.transaction(async (tx) => {
      await migration.up(tx)
      await migration.backfill?.(tx)
    })
}

/** The tables in an owner's schema or file. */
export async function ownerTablesIn(db: Db, place: OwnerPlace): Promise<string[]> {
  if (place.dialect === 'sqlite') {
    if (!place.file || (place.file !== ':memory:' && !existsSync(place.file))) return []
    const owned = await openOwner(db, place)
    try {
      const rows = await owned.query<{ name: string }>(owned.dialect.tableNames)
      return rows
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_'))
        .sort()
    } finally {
      if (place.file !== ':memory:') await owned.close()
    }
  }
  const rows = await (
    db.q as unknown as Kysely<{
      'information_schema.tables': { table_name: string; table_schema: string; table_type: string }
    }>
  )
    .selectFrom('information_schema.tables')
    .select('table_name')
    .where('table_schema', '=', place.schema)
    .where('table_type', '=', 'BASE TABLE')
    .orderBy('table_name')
    .execute()
  return rows.map((row) => row.table_name)
}

/**
 * Drops the owner's schema and role, or deletes its file, and forgets its state
 * and role, so adding it again starts its chain from the beginning. Ledgered as
 * a `purge`. A role the CMS may not drop is left, and said.
 */
export async function purgeOwnerTables(
  db: Db,
  place: OwnerPlace,
  options: { by?: string; stateKey: string },
): Promise<{ tables: string[]; roleLeft?: string }> {
  const tables = await ownerTablesIn(db, place)
  const started = performance.now()
  let roleLeft: string | undefined
  if (place.dialect === 'sqlite') {
    if (place.file && place.file !== ':memory:')
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${place.file}${suffix}`, { force: true })
    else {
      // In memory there is no file to delete, so its tables go one by one.
      const owned = await openOwner(db, place)
      for (const table of tables) await owned.q.schema.dropTable(table).execute()
    }
  } else if (place.role) {
    const role = place.role
    await db.transaction(async (tx) => {
      await asOwner(tx, place, undefined, (owned) =>
        owned.q.schema.dropSchema(place.schema).ifExists().cascade().execute(),
      )
    })
    try {
      await db.exec(`DROP ROLE IF EXISTS ${db.dialect.quote(role)}`)
    } catch {
      roleLeft = role
    }
    await forgetOwner(db, place.id)
  }
  await deleteKeyValue(db, options.stateKey)
  await recordInLedger(db, {
    name: `purge ${place.id}`,
    kind: 'purge',
    durationMs: Math.round(performance.now() - started),
    appliedBy: options.by ?? null,
    note: tables.length > 0 ? `dropped ${tables.join(', ')}` : 'no tables',
    bundle: place.id,
  })
  return { tables, ...(roleLeft ? { roleLeft } : {}) }
}
