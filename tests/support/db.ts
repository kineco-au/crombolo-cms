/** Test harness for running the same suite against both dialects. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  connect,
  cromboloPlan,
  type Db,
  DEFAULT_LOG_SEARCHES,
  type DialectName,
  LogSearchRepository,
  MIGRATION_STATE_KEY,
  migrate,
  pendingMigrations,
  resolveDialectName,
} from '@crombolo/data'

// Tests build their throwaway sites with `mkdtemp` under `output/`, which does not
// create parents. Every such test reaches this module, directly or through
// harness.ts, and an import is evaluated before the importer's body — so this is
// the one place that cannot be skipped by a test that needs the directory.
mkdirSync(join(process.cwd(), 'output'), { recursive: true })

export const dialectUnderTest: DialectName = resolveDialectName()

let postgresReachable: boolean | undefined

/**
 * Makes sure the test database has a `public` schema, using a connection of its
 * own rather than `connect()`.
 *
 * A run interrupted between the drop and the create in `resetPostgresSchema`
 * leaves the database with no schemas at all — and `connect()` issues
 * `CREATE EXTENSION IF NOT EXISTS citext` on every Postgres connection, which
 * needs a schema on the search_path to put it in. So every later run fails at
 * *connect*, before reaching the code that would recreate the schema, with 240-odd
 * "no schema has been selected to create in" errors and no way out but psql.
 * Repairing it here costs one statement and makes a Ctrl-C survivable.
 */
async function ensurePublicSchema(): Promise<void> {
  const url = Bun.env.CROMBOLO_POSTGRES_URL ?? Bun.env.DATABASE_URL
  if (!url) return
  const { SQL } = await import('bun')
  const sql = new SQL({ url, max: 1 })
  try {
    await sql.unsafe('CREATE SCHEMA IF NOT EXISTS public')
  } finally {
    await sql.close()
  }
}

export async function canConnect(): Promise<boolean> {
  if (dialectUnderTest === 'sqlite') return true
  if (postgresReachable !== undefined) return postgresReachable
  try {
    const db = await connect()
    await db.query('SELECT 1')
    await db.close()
    postgresReachable = true
  } catch {
    postgresReachable = false
  }
  return postgresReachable
}

/**
 * A fresh, empty database for one test.
 *
 * SQLite gets its own in-memory database. Postgres resets the `public` schema
 * instead of creating a per-test one: `SET search_path` is per-connection and
 * Bun's SQL client pools connections, so a search_path set on one connection
 * does not apply to the next query. Resetting the schema is pooling-safe.
 * The cost is that files within one run go one at a time; separate runs each
 * have a database of their own (`isolate.ts`).
 *
 * The schema is ensured before connecting and the extension is qualified, both so
 * that a run interrupted mid-reset recovers by itself; see `ensurePublicSchema`.
 */
export async function freshDb(): Promise<Db> {
  if (dialectUnderTest === 'sqlite') return connect({ dialect: 'sqlite', file: ':memory:' })
  await ensurePublicSchema()
  const db = await connect({ dialect: 'postgres' })
  await dropOwners(db)
  await db.exec('DROP SCHEMA IF EXISTS public CASCADE')
  await db.exec('CREATE SCHEMA public')
  await db.exec('CREATE EXTENSION IF NOT EXISTS citext SCHEMA public')
  return db
}

/**
 * A connected database with every framework migration applied and nothing in
 * it: what a test that only needs a clean, current schema asks for.
 *
 * On Postgres it empties the run's already-migrated schema (the same fast path
 * a server boot takes, `resetPostgresSchema`) rather than dropping it. Dropping
 * it costs a full migration here, and another one at the next server boot.
 * `freshDb` stays for a test that needs the schema empty: one about migrations
 * themselves.
 */
export async function migratedDb(): Promise<Db> {
  if (dialectUnderTest === 'sqlite') {
    const db = await connect({ dialect: 'sqlite', file: ':memory:' })
    await migrate(db, cromboloPlan)
    return db
  }
  await resetPostgresSchema()
  const db = await connect({ dialect: 'postgres' })
  // Nothing to do when the reset kept the schema; the full plan when it rebuilt.
  await migrate(db, cromboloPlan)
  return db
}

/** Undoes migration 050, media permissions: its index before its columns, then its tables. */
export async function undoMediaAccess(db: Db): Promise<void> {
  await undoMediaMemberUploads(db)
  await undoMediaPagingIndexes(db)
  await db.exec('DROP INDEX IF EXISTS ix_content_file_url')
  for (const column of ['file_url', 'creator_member_key', 'read_policy', 'write_policy'])
    await db.exec(`ALTER TABLE content DROP COLUMN ${column}`)
  await db.exec('DROP TABLE IF EXISTS node_file')
  await db.exec('DROP TABLE IF EXISTS media_access_rule')
  await db.exec('DROP TABLE IF EXISTS media_access')
}

/** Undoes 052, which 050's undo calls first: it comes after it. */
export async function undoMediaMemberUploads(db: Db): Promise<void> {
  // 056 (story 225), 055, jobs (story 187), and 054, bundle grants (story 222),
  // come after it; 056's columns go with 054's table.
  await db.exec("DELETE FROM migration_history WHERE name = 'DisableBundles'")
  await db.exec('DROP TABLE IF EXISTS job_schedule')
  await db.exec('DROP INDEX IF EXISTS ix_job_owner')
  await db.exec('DROP INDEX IF EXISTS ix_job_due')
  await db.exec('DROP TABLE IF EXISTS job')
  await db.exec("DELETE FROM migration_history WHERE name = 'AddJobs'")
  await db.exec('DROP TABLE IF EXISTS bundle_grant')
  await db.exec("DELETE FROM migration_history WHERE name = 'AddBundleGrants'")
  await db.exec('DROP TABLE IF EXISTS media_access_member')
  await db.exec("DELETE FROM migration_history WHERE name = 'AddMediaMemberGrants'")
  for (const column of ['member_types', 'member_max_bytes'])
    await db.exec(`ALTER TABLE media_access DROP COLUMN ${column}`)
  await db.exec("DELETE FROM migration_history WHERE name = 'AddMediaMemberUploads'")
}

/** Undoes 051, which 050's undo calls first: it comes after it. */
export async function undoMediaPagingIndexes(db: Db): Promise<void> {
  await db.exec('DROP INDEX IF EXISTS ix_node_parent_sort')
  await db.exec('DROP INDEX IF EXISTS ix_cache_instruction_checkpoint')
  await db.exec("DELETE FROM migration_history WHERE name = 'AddMediaPagingIndexes'")
}

/**
 * Undoes what migrations 010 onward did — their tables, dependants first, 011's
 * column rename, the table renames in 018 and 027, 031–032's search index, 033's
 * audit log and 034's columns —
 * so a test can rewind the recorded state to before them and migrate forward again.
 *
 * Every migration that creates or renames something needs its undo here, or the
 * replay runs its `CREATE TABLE` against a table that is already there.
 */
export async function undoMigrationsSinceContentEditing(db: Db): Promise<void> {
  // 052, 051 and 050
  await undoMediaAccess(db)
  // 049
  await db.exec('DROP TABLE IF EXISTS content_applied')
  // 047
  await db.exec('DROP TABLE IF EXISTS content_checkpoint')
  await db.exec('ALTER TABLE cache_instruction DROP COLUMN checkpoint')
  await db.exec('ALTER TABLE server DROP COLUMN served_checkpoint')
  await db.exec('ALTER TABLE server DROP COLUMN served_at')
  // 046
  await db.exec('DROP INDEX IF EXISTS ux_content_notification_event')
  await db.exec('ALTER TABLE content_notification DROP COLUMN event_id')
  await db.exec('DROP INDEX IF EXISTS ux_webhook_delivery_event')
  await db.exec('ALTER TABLE webhook_delivery DROP COLUMN event_id')
  await db.exec('DROP TABLE IF EXISTS content_event')
  // 044
  await db.exec('ALTER TABLE approval_request DROP COLUMN schedule')
  // 043
  await db.exec('DROP INDEX IF EXISTS ix_user_notification_node_action')
  await db.exec('DROP TABLE IF EXISTS content_notification')
  // 042
  await db.exec('ALTER TABLE document DROP COLUMN trashed_date')
  // 041
  await db.exec('DROP TABLE IF EXISTS remote_job')
  await db.exec('DROP TABLE IF EXISTS device_authorization')
  // 040
  await db.exec('DROP TABLE IF EXISTS two_factor_recovery_code')
  await db.exec('DROP TABLE IF EXISTS two_factor_login')
  // 039: SQLite's FTS table, then the table its triggers are on, which takes them with it.
  await db.exec('DROP TABLE IF EXISTS site_search_document_fts')
  await db.exec('DROP TABLE IF EXISTS site_search_document')
  await db.exec('ALTER TABLE property_type DROP COLUMN site_search')
  await db.exec('ALTER TABLE content_type DROP COLUMN site_search')
  // 038
  for (const table of ['approval_history', 'approval_step', 'approval_request'])
    await db.exec(`DROP TABLE IF EXISTS ${table}`)
  // 037
  await db.exec('DROP TABLE IF EXISTS delivery_member_token')
  // 036
  for (const table of ['transfer_answer', 'transfer_pending'])
    await db.exec(`DROP TABLE IF EXISTS ${table}`)
  // 035
  for (const table of ['webhook_log', 'webhook_delivery', 'webhook'])
    await db.exec(`DROP TABLE IF EXISTS ${table}`)
  await db.exec('ALTER TABLE form_entry_value DROP COLUMN label')
  await db.exec('ALTER TABLE server DROP COLUMN crombolo_version')
  await db.exec('DROP TABLE IF EXISTS audit_entry')
  // 032's column, and 031's index and queue. SQLite's FTS table and its triggers
  // go with them: the triggers are dropped with the table they are on.
  await db.exec('ALTER TABLE property_type DROP COLUMN searchable')
  await db.exec('DROP TABLE IF EXISTS search_document_fts')
  await db.exec('DROP TABLE IF EXISTS search_index_queue')
  await db.exec('DROP TABLE IF EXISTS search_document')
  // 018 renamed the report table, so the replay would rename an absent one.
  await db.exec('DROP INDEX IF EXISTS ix_change_report_subject')
  await db.exec('ALTER TABLE change_report DROP COLUMN source')
  await db.exec('ALTER TABLE change_report DROP COLUMN scope')
  await db.exec('ALTER TABLE change_report RENAME TO upgrade_report')
  await db.exec(
    'CREATE INDEX ix_upgrade_report_subject ON upgrade_report (code, subject_key, property_alias, culture)',
  )
  await db.exec('ALTER TABLE user_account RENAME COLUMN is_locked_out TO is_disabled')
  await db.exec('ALTER TABLE document_culture_variation DROP COLUMN published_event_id')
  await db.exec('ALTER TABLE document_culture_variation DROP COLUMN published_name')
  // 021's column on `server`.
  await db.exec('ALTER TABLE server DROP COLUMN role')
  // 027 renamed 022's table, so the replay would rename an absent one.
  await db.exec('DROP INDEX IF EXISTS ux_bundle_name')
  await db.exec('ALTER TABLE bundle RENAME TO created_package')
  await db.exec('CREATE UNIQUE INDEX ux_created_package_name ON created_package (name)')
  for (const table of [
    // 022
    'created_package',
    'form_workflow_run',
    'form_entry_value',
    'form_entry',
    'content_transfer_change',
    'content_transfer_run',
    'assistant_change',
    'assistant_changeset',
    'redirect_url',
    'public_access_rule',
    'public_access',
    'external_login_token',
    'external_login',
    'member_group_member',
    'member',
    'log_viewer_query',
    'dictionary_text',
    'dictionary_item',
    'user_client_credential',
    'user_token',
    'user_data',
    'user_group_language',
    'content_schedule',
    'user_notification',
    'domain',
  ])
    await db.exec(`DROP TABLE IF EXISTS ${table}`)
}

/**
 * Written by a migration rather than by seeding, so emptying these leaves nothing
 * to put them back: the migrations are exactly what the fast path skips.
 *
 * `key_value` holds the applied-state row the skip depends on, `migration_history`
 * the ledger, and `schema_state` the row a value migration installs — without
 * which every write fails with "the database is not installed".
 */
const MIGRATION_OWNED = ['migration_history', 'key_value', 'schema_state']

/**
 * Empties an already-migrated schema instead of rebuilding it.
 *
 * Dropping the schema makes `createServer` replay every framework migration, and
 * the schema it rebuilds is identical each time: that replay was 644 ms of the
 * 818 ms a Postgres test spent before it had even begun, against 97 ms for the
 * same work on SQLite. Truncating instead costs 62 ms, and seeding is idempotent
 * and keys off the data being absent, so it still runs.
 *
 * Returns false when the schema is not at the state this code expects — nothing
 * migrated yet, a `freshDb` test having dropped it, or a migration test having
 * rewound it — leaving the caller to rebuild.
 */
async function emptyMigratedSchema(db: Db): Promise<boolean> {
  try {
    if ((await pendingMigrations(db, cromboloPlan)).length > 0) return false
  } catch {
    // Thrown when the database is ahead of this code; rebuilding is the answer.
    return false
  }
  const tables = (
    await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    )
  )
    .map((row) => row.table_name)
    .filter((name) => !MIGRATION_OWNED.includes(name))
  // Custom tables are not core's: a fresh install has none, so their ledger
  // rows go with their schemas (`dropOwners`), and each chain starts again
  // exactly as it would on a new database.
  await db.exec('DELETE FROM migration_history WHERE bundle IS NOT NULL')
  if (tables.length === 0) return false

  // Read from the catalogue rather than listed here, so a migration that adds a
  // table does not quietly leave it leaking state between tests.
  //
  // One statement, and deliberately not CASCADE: every table referencing another
  // is in the list already, whereas CASCADE would additionally reach whatever
  // references what is being emptied. `RESTART IDENTITY` so sequences start where
  // a rebuilt schema would leave them.
  await db.exec(`TRUNCATE ${tables.map((name) => `"${name}"`).join(', ')} RESTART IDENTITY`)
  // Everything except the applied-state row, which is what the skip depends on.
  await db.exec('DELETE FROM key_value WHERE key <> ?', [MIGRATION_STATE_KEY])
  // The migration-installed row, and nothing a test synced on top of it: the
  // content tables referencing those rows have just been emptied, so the only
  // thing left to match a fresh install is the first row.
  await db.exec('DELETE FROM schema_state WHERE id <> (SELECT min(id) FROM schema_state)')
  // The saved searches a migration installs. Emptied with the rest rather than
  // held back, because tests add and remove their own and one left behind by a
  // failure would follow the next test — so they are put back from the list the
  // migration itself installs, which keeps one source of truth.
  const searches = new LogSearchRepository(db)
  for (const search of DEFAULT_LOG_SEARCHES) await searches.create(search.name, search.query)
  // The content checkpoint's one row, as migration 047 installs it.
  await db.exec('INSERT INTO content_checkpoint (id, n) VALUES (1, 0)')
  return true
}

/**
 * Drops the site's and bundles' schemas in this database, and the roles made
 * for them (story 189). A role belongs to the whole server, so only those whose
 * comment names this database are touched.
 */
export async function dropOwners(db: Db): Promise<void> {
  if (db.dialect.name !== 'postgres') return
  const schemas = await db.query<{ name: string }>(
    `SELECT nspname AS name FROM pg_namespace WHERE nspname = 'site' OR nspname LIKE 'bundle\\_%'`,
  )
  for (const { name } of schemas) await db.exec(`DROP SCHEMA IF EXISTS "${name}" CASCADE`)
  const roles = await db.query<{ name: string }>(
    `SELECT rolname AS name FROM pg_roles
     WHERE shobj_description(oid, 'pg_authid') = 'crombolo custom tables for ' || current_database()`,
  )
  for (const { name } of roles) await db.exec(`DROP ROLE IF EXISTS "${name}"`)
}

/**
 * A run's Postgres tests share its database (one per run: `isolate.ts`), so the
 * data is cleared before a server boots — otherwise seeding is skipped as
 * already done and state leaks between tests and files. SQLite gets a private
 * in-memory database and needs nothing.
 */
export async function resetPostgresSchema(): Promise<void> {
  if (dialectUnderTest !== 'postgres') return
  await ensurePublicSchema()
  const db = await connect({ poolSize: 1 })
  try {
    await dropOwners(db)
    if (await emptyMigratedSchema(db)) return
    // One transaction, because DDL is transactional in Postgres and the drop and
    // the create must not be separable. A test that times out between them — which
    // a slow machine makes possible — leaves the database with no `public` schema,
    // and every later file then fails with "no schema has been selected to create
    // in", which looks like a dozen unrelated bugs rather than one interrupted
    // reset. Rolled back, the worst case is a reset that did not happen.
    await db.transaction(async (tx) => {
      await tx.exec('DROP SCHEMA IF EXISTS public CASCADE')
      await tx.exec('CREATE SCHEMA public')
      // Qualified for the same reason as in `freshDb`: an interrupted run leaves no
      // schema, and an unqualified CREATE EXTENSION then fails for good.
      await tx.exec('CREATE EXTENSION IF NOT EXISTS citext SCHEMA public')
    })
  } finally {
    await db.close()
  }
}
