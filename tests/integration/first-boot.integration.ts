/**
 * Story 080: the first boot of a self-hosted site, through the real CLI. A
 * production install given no password asks its owner to set it up, guarded by
 * a code it never prints; a server that cannot reach its database says so in
 * the browser and on /health while it retries, then gives up.
 *
 * Named `*.integration.ts`, so `bun test` does not collect it.
 */

import { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  dropSiteDatabases,
  onPostgres,
  postgresEnv,
  type SiteDatabase,
  siteDatabase,
} from './support/database.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')
const CODE = 'integration-setup-code-0123'

let dir: string
const site = () => join(dir, 'site')

let database: SiteDatabase | undefined
function environment(extra: Record<string, string> = {}): Record<string, string> {
  const inherited = { ...(process.env as Record<string, string>) }
  for (const name of [
    'CROMBOLO_SQLITE_FILE',
    'CROMBOLO_COMPONENTS_DIR',
    'CROMBOLO_SCHEMA_DIR',
    'CROMBOLO_MEDIA_DIR',
    'CROMBOLO_ADMIN_PASSWORD',
    'CROMBOLO_SITE_NAME',
  ])
    delete inherited[name]
  return {
    ...inherited,
    CROMBOLO_DB: 'sqlite',
    ...postgresEnv(database),
    CROMBOLO_LOGS_DIR: join(dir, 'logs'),
    CROMBOLO_LOG_TO_CONSOLE: 'false',
    NODE_ENV: 'production',
    PORT: '0',
    ...extra,
  }
}

/** Reads a process's output until `until` appears, without waiting for it to exit. */
async function readUntil(proc: Bun.Subprocess, stream: 'stdout' | 'stderr', until: string) {
  const decoder = new TextDecoder()
  let text = ''
  const timer = setTimeout(() => proc.kill(), 60_000)
  for await (const chunk of proc[stream] as ReadableStream<Uint8Array>) {
    text += decoder.decode(chunk)
    if (text.includes(until)) break
  }
  clearTimeout(timer)
  return text
}

beforeAll(async () => {
  dir = mkdtempSync(join(ROOT, 'output', 'crombolo-first-boot-'))
  database = await siteDatabase(dir, 'first_boot')
  mkdirSync(site(), { recursive: true })
  const init = Bun.spawn(['bun', CLI, 'init', '--name', 'First Boot'], {
    cwd: site(),
    env: environment(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(await init.exited).toBe(0)
}, 120_000)

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true })
  await dropSiteDatabases()
})

describe('the first boot of a self-hosted site', () => {
  test('without a password it asks to be set up, never prints the code, and stays set up', async () => {
    const start = () =>
      Bun.spawn(['bun', CLI, 'start'], {
        cwd: site(),
        env: environment({ CROMBOLO_SETUP_CODE: CODE }),
        stdout: 'pipe',
        stderr: 'pipe',
      })
    const first = start()
    const banner = await readUntil(first, 'stdout', '└─')
    expect(banner).toContain('Set up your new site at')
    expect(banner).not.toContain(CODE)
    expect(banner).not.toContain('password')
    const setupUrl = /(http:\/\/\S+\/setup)/.exec(banner)?.[1] as string
    expect((await fetch(setupUrl)).status).toBe(200)
    const done = await fetch(setupUrl, {
      method: 'POST',
      body: new URLSearchParams({
        name: 'Owner',
        email: 'owner@example.com',
        password: 'a long enough password',
        confirm: 'a long enough password',
        code: CODE,
      }),
    })
    expect(await done.text()).toContain('Your site is ready')
    first.kill()
    await first.exited

    const second = start()
    const again = await readUntil(second, 'stdout', '└─')
    expect(again).not.toContain('Set up your new site')
    const url = /backoffice\s+(http:\/\/\S+)/.exec(again)?.[1] as string
    const setup = await fetch(`${url}/setup`, { redirect: 'manual' })
    expect(setup.status).toBe(303)
    second.kill()
    await second.exited
  }, 120_000)

  test('a database it cannot reach is explained in the browser while it retries, then it stops', async () => {
    const proc = Bun.spawn(['bun', CLI, 'start'], {
      cwd: site(),
      env: environment({
        CROMBOLO_DB: 'postgres',
        CROMBOLO_POSTGRES_URL: 'postgres://site:s3cret-pass@127.0.0.1:1/site',
        CROMBOLO_BOOT_ATTEMPTS: '2',
      }),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const said = await readUntil(proc, 'stderr', 'explains this while it retries.')
    expect(said).toContain("Can't reach the database")
    expect(said).not.toContain('s3cret-pass')
    const url = /(http:\/\/\S+) explains this/.exec(said)?.[1] as string
    const page = await fetch(url)
    expect(page.status).toBe(503)
    const html = await page.text()
    expect(html).toContain('CROMBOLO_POSTGRES_URL')
    expect(html).not.toContain('s3cret-pass')
    expect((await fetch(`${url}health`)).status).toBe(503)
    expect(await proc.exited).not.toBe(0)
  }, 120_000)

  // Story 085: the rewind edits SQLite's file; on Postgres the same upgrade is proven by
  // tests/upgrade-from-release.test.ts, from a real release's database.
  test.skipIf(onPostgres)(
    'a database the previous release left is upgraded by `crombolo upgrade`, and then starts',
    async () => {
      const file = readdirSync(site()).find((name) => name.endsWith('.sqlite')) as string
      const sqlite = new Database(join(site(), file))
      // 098 (story 419), 097 (story 414), 096 (story 408), 095 (story 405), 094 (story 399), 093 (story 400), 092 (story 396), 091 (story 395), 090 (story 384), 089 (story 387), 088 (story 383), 087 (story 379), 086 (story 381), 085 (story 376), then 084.
      // 108 (story 450): rows that stay.
      sqlite.exec("DELETE FROM migration_history WHERE name = 'FileTypeWording'")
      // 107 (story 451): a table of its own.
      sqlite.exec('DROP TABLE workspace_group')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceGroups'")
      // 106 (story 447): a table of its own.
      sqlite.exec('DROP TABLE shared_link')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddSharedLinks'")
      // 105 (story 445): a column on a table that stays.
      sqlite.exec('ALTER TABLE member DROP COLUMN managed_by')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMemberManager'")
      // 104 (stories 440, 441): a webhook's workflows.
      sqlite.exec('ALTER TABLE webhook DROP COLUMN workflows')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'RenameWebhookEvents'")
      // 103 (story 282): two tables of its own.
      for (const table of ['member_reset_token', 'rate_limit_hit'])
        sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMemberPasswordReset'")
      // 102 (story 433): columns on a table that stays.
      for (const column of ['last_used_at', 'old_secret_hash', 'old_secret_until'])
        sqlite.exec(`ALTER TABLE user_client_credential DROP COLUMN ${column}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddServiceAccountSecrets'")
      // 101 (story 436): the site-wide UNIQUE back, rebuilding node with foreign keys off.
      for (const index of ['ux_node_key_shared', 'ux_node_key_workspace', 'ix_node_unique_id'])
        sqlite.exec(`DROP INDEX ${index}`)
      sqlite.exec('PRAGMA foreign_keys = OFF')
      const node = sqlite
        .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'node'")
        .get() as { sql: string }
      const indexes = sqlite
        .query(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'node' AND sql IS NOT NULL",
        )
        .all() as Array<{ sql: string }>
      sqlite.exec(
        node.sql
          .replace(/(unique_id\s+\S+\s+NOT NULL)/i, '$1 UNIQUE')
          .replace(/^CREATE TABLE\s+"?node"?/i, 'CREATE TABLE node_rebuilt'),
      )
      sqlite.exec('INSERT INTO node_rebuilt SELECT * FROM node')
      sqlite.exec('DROP TABLE node')
      sqlite.exec('ALTER TABLE node_rebuilt RENAME TO node')
      for (const index of indexes) sqlite.exec(index.sql)
      sqlite.exec('PRAGMA foreign_keys = ON')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'KeysPerWorkspace'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'PutUsersInSettings'")
      sqlite.exec('ALTER TABLE workspace DROP COLUMN description')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceDescription'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspacePlaces'")
      sqlite.exec('DROP TABLE workspace_schedule')
      sqlite.exec('ALTER TABLE content_schedule DROP COLUMN change_key')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceSchedules'")
      sqlite.exec('DROP TABLE workspace_error')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceErrors'")
      for (const column of ['start_content_key', 'start_media_key', 'start_element_key'])
        sqlite.exec(`ALTER TABLE user_group DROP COLUMN ${column}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddGroupStartKeys'")
      sqlite.exec('DROP TABLE change_source')
      sqlite.exec('DROP TABLE change_source_staged')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddChangeSources'")
      sqlite.exec('DROP TABLE workspace_conflict_raised')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceConflictsRaised'")
      sqlite.exec('DROP TABLE workspace_process')
      sqlite.exec('DROP TABLE workspace_process_failure')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceProcesses'")
      sqlite.exec('DROP TABLE served_change')
      sqlite.exec('DROP TABLE backoffice_notice')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddServedChanges'")
      sqlite.exec('ALTER TABLE workspace DROP COLUMN visibility')
      sqlite.exec('ALTER TABLE workspace DROP COLUMN tell_others')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspacePrivacy'")
      sqlite.exec('ALTER TABLE property_value DROP COLUMN environment')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddEnvironmentValues'")
      sqlite.exec('DROP TABLE applied_change')
      sqlite.exec('ALTER TABLE workspace DROP COLUMN staged_changes')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddChangeTransfer'")
      sqlite.exec('DROP TABLE workspace_link')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceLinks'")
      sqlite.exec('DROP TABLE change_item')
      for (const column of [
        'change_kind',
        'name',
        'change_key',
        'made_by',
        'workspace_key',
        'closed_at',
      ])
        sqlite.exec(`ALTER TABLE content_transfer_run DROP COLUMN ${column}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddChanges'")
      for (const table of ['workspace_file', 'file_blob']) sqlite.exec(`DROP TABLE ${table}`)
      for (const index of [
        'ux_content_type_workspace_alias',
        'ix_content_type_workspace',
        'ix_data_type_workspace',
        'ux_content_type_alias',
      ])
        sqlite.exec(`DROP INDEX ${index}`)
      for (const [table, columns] of [
        ['workspace', ['schema_built']],
        ['content_type', ['workspace_id', 'origin_key']],
        ['data_type', ['workspace_id', 'origin_key']],
        ['property_type', ['origin_key']],
        ['property_type_group', ['origin_key']],
      ] as const)
        for (const column of columns) sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
      sqlite.exec('CREATE UNIQUE INDEX ux_content_type_alias ON content_type (alias)')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceSchema'")
      for (const [table, columns] of [
        ['workspace', ['state', 'merged_at', 'merged_by', 'personal']],
        ['workspace_document', ['base_published']],
        ['workspace_document_culture', ['base_published', 'base_published_event_id']],
        ['workspace_pending', ['base_parent_id', 'base_sort_order', 'base_event_id', 'name']],
      ] as const)
        for (const column of columns) sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaceMerge'")
      sqlite.exec(
        "DELETE FROM user_group_section WHERE app_alias IN ('pages', 'structure', 'components')",
      )
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddContentPlaces'")
      for (const [table, index] of [
        ['node', 'ix_node_workspace'],
        ['content_version', 'ix_content_version_workspace'],
        ['property_value', 'ix_property_value_workspace'],
        ['content_schedule', 'ix_content_schedule_workspace'],
      ]) {
        sqlite.exec(`DROP INDEX IF EXISTS ${index}`)
        sqlite.exec(`ALTER TABLE ${table} DROP COLUMN workspace_id`)
      }
      for (const table of [
        'workspace_pending',
        'workspace_document_culture',
        'workspace_document',
        'workspace_member',
        'workspace',
      ])
        sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddWorkspaces'")
      sqlite.exec('ALTER TABLE audit_entry DROP COLUMN actor_name')
      sqlite.exec('ALTER TABLE audit_entry DROP COLUMN actor_id')
      sqlite.exec('ALTER TABLE device_authorization DROP COLUMN actor_name')
      sqlite.exec('ALTER TABLE device_authorization DROP COLUMN actor_id')
      sqlite.exec('DROP INDEX IF EXISTS ux_single_use_token')
      sqlite.exec('DROP TABLE IF EXISTS single_use_token')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'RenameSingleUseToken'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddExchangeActor'")
      sqlite.exec('DROP INDEX IF EXISTS ux_remote_exchange_id')
      sqlite.exec('DROP TABLE IF EXISTS remote_exchange_id')
      sqlite.exec('DROP INDEX IF EXISTS ix_external_login_identity')
      sqlite.exec('ALTER TABLE external_login DROP COLUMN identity_issuer')
      sqlite.exec('ALTER TABLE external_login DROP COLUMN identity_value')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddRemoteExchange'")
      sqlite.exec('DROP INDEX IF EXISTS ux_cli_token_name')
      sqlite.exec('DROP TABLE IF EXISTS cli_token')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddCliTokens'")
      sqlite.exec('ALTER TABLE user_login_session DROP COLUMN view_as_until')
      sqlite.exec('ALTER TABLE user_login_session DROP COLUMN view_as_groups')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddSessionViewAs'")
      sqlite.exec(
        'CREATE TABLE IF NOT EXISTS user_start_node (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES user_account (id), start_node INTEGER NOT NULL, start_node_type INTEGER NOT NULL)',
      )
      sqlite.exec("DELETE FROM migration_history WHERE name = 'DropUserStartNodes'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'PruneGroupPermissions'")
      sqlite.exec('DROP TABLE IF EXISTS user_group_owner')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddUserGroupOwners'")
      sqlite.exec('DROP TABLE IF EXISTS form_workflow_secret')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddFormWorkflowSecrets'")
      sqlite.exec('DROP TABLE IF EXISTS extension_activity')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddExtensionActivity'")
      sqlite.exec('ALTER TABLE bundle_grant DROP COLUMN delegate_key')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddBundleGrantDelegate'")
      sqlite.exec('ALTER TABLE content_type DROP COLUMN seo')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddContentTypeSeo'")
      sqlite.exec('DROP TABLE IF EXISTS trusted_signer')
      sqlite.exec('ALTER TABLE content_transfer_run DROP COLUMN signed_by')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddTrustedSigners'")
      sqlite.exec('ALTER TABLE bundle DROP COLUMN kind')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddBundleKind'")
      sqlite.exec('DROP TABLE IF EXISTS extension_setting')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddExtensionSettings'")
      sqlite.exec('ALTER TABLE bundle_grant DROP COLUMN act_as')
      sqlite.exec('ALTER TABLE bundle_grant DROP COLUMN origins')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddBundleGrantReach'")
      sqlite.exec('ALTER TABLE content_transfer_run DROP COLUMN bundle_type')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddTransferRunBundleType'")
      sqlite.exec('DROP TABLE IF EXISTS search_removal')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddSearchRemovals'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddImageAltText'")
      sqlite.exec('DROP INDEX IF EXISTS ix_node_parent_tree')
      sqlite.exec('ALTER TABLE node DROP COLUMN tree_group')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMediaTreeOrder'")
      sqlite.exec('DROP TABLE IF EXISTS remote_ci_token')
      sqlite.exec('DROP TABLE IF EXISTS remote_trust_rule')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddRemoteTrust'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'MoveBundlesIntoSettings'")
      sqlite.exec('DROP INDEX IF EXISTS ix_form_entry_library')
      sqlite.exec('ALTER TABLE form_entry DROP COLUMN library_key')
      sqlite.exec('ALTER TABLE content_type DROP COLUMN form_key')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddFormLibrary'")
      sqlite.exec('ALTER TABLE bundle DROP COLUMN schema_picks')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddBundleSchemaPicks'")
      sqlite.exec('ALTER TABLE content_type DROP COLUMN site_settings')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddSiteSettingsTypes'")
      sqlite.exec("DELETE FROM migration_history WHERE name = 'DisableBundles'")
      sqlite.exec('DROP TABLE IF EXISTS job_schedule')
      sqlite.exec('DROP TABLE IF EXISTS job')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddJobs'")
      sqlite.exec('DROP TABLE IF EXISTS bundle_grant')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddBundleGrants'")
      sqlite.exec('DROP TABLE IF EXISTS media_access_member')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMediaMemberGrants'")
      // As 0.34.0 left it: before media permissions (050), the media paging
      // indexes (051) and members' uploads (052). Every migration since the last
      // release has to be undone here, an index before its columns.
      for (const column of ['member_types', 'member_max_bytes'])
        sqlite.exec(`ALTER TABLE media_access DROP COLUMN ${column}`)
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMediaMemberUploads'")
      sqlite.exec('DROP INDEX IF EXISTS ix_node_parent_sort')
      sqlite.exec('DROP INDEX IF EXISTS ix_cache_instruction_checkpoint')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMediaPagingIndexes'")
      sqlite.exec('DROP INDEX IF EXISTS ix_content_file_url')
      for (const column of ['file_url', 'creator_member_key', 'read_policy', 'write_policy'])
        sqlite.exec(`ALTER TABLE content DROP COLUMN ${column}`)
      sqlite.exec('DROP TABLE IF EXISTS node_file')
      sqlite.exec('DROP TABLE IF EXISTS media_access_rule')
      sqlite.exec('DROP TABLE IF EXISTS media_access')
      sqlite.exec("DELETE FROM migration_history WHERE name = 'AddMediaAccess'")
      sqlite
        .query("UPDATE key_value SET value = ? WHERE key = 'Crombolo.Core.Upgrader.State'")
        .run('{5d1f8a3c-0049-4e72-b6a9-3c8e1f4d2b49}')
      sqlite.close()

      const run = async (...args: string[]) => {
        const proc = Bun.spawn(['bun', CLI, ...args], {
          cwd: site(),
          env: environment({ CROMBOLO_BOOT_ATTEMPTS: '1' }),
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [out, err] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ])
        return { code: await proc.exited, out: `${out}${err}` }
      }
      const refused = await run('start')
      expect(refused.code, refused.out).not.toBe(0)
      expect(refused.out).toContain('An upgrade is waiting')
      expect(refused.out).toContain('crombolo upgrade')

      const upgraded = await run('upgrade')
      expect(upgraded.code, upgraded.out).toBe(0)
      const ledger = await run('upgrade', 'ledger')
      expect(ledger.out).toContain('AddMediaAccess')

      const proc = Bun.spawn(['bun', CLI, 'start'], {
        cwd: site(),
        env: environment(),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(await readUntil(proc, 'stdout', '└─')).toContain('Crombolo is running')
      proc.kill()
      await proc.exited
    },
    180_000,
  )
})
