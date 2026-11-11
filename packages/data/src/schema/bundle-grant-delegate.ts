/**
 * Migration 071 — who granted `user.delegate` (story 325), whom a job or an
 * event acts for when nobody is using it. `actAs` is retired: a grant that
 * chose the installer keeps that person here, and one that chose the caller or
 * a named user has nothing to keep, since no version asking for `actAs` runs
 * now. `act_as` stays, unread, so this release still upgrades node by node; a
 * later release's contract drops it.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_CONTENT_TYPE_SEO } from './content-type-seo.ts'

export const STATE_BUNDLE_GRANT_DELEGATE = '{9d4b27e6-0071-4c58-8a1f-3e6d5b2c7071}'

const INSTALLER = 'installer:'

export const bundleGrantDelegateMigration: Migration = {
  from: STATE_CONTENT_TYPE_SEO,
  to: STATE_BUNDLE_GRANT_DELEGATE,
  name: 'AddBundleGrantDelegate',
  kind: 'expand',
  release: '0.61.0',
  async up(db: Db) {
    await schemaOps(db).addColumn('bundle_grant', 'delegate_key', db.dialect.types.varchar(36))
    // One statement, reading nothing first, so `upgrade check` can plan it.
    await db.q
      .updateTable('bundle_grant')
      .set((eb) => ({
        delegate_key: eb.fn<string>('substr', ['act_as', eb.val(INSTALLER.length + 1)]),
      }))
      .where('act_as', 'like', `${INSTALLER}%`)
      .execute()
  },
}
