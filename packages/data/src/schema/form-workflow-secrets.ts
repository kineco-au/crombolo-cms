/**
 * Migration 073 — a form workflow's secret headers (story 304): each sealed
 * with `CROMBOLO_SECRET_KEY` and kept here rather than in the form's file,
 * with the URL it was set for, so it is sent only there.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_EXTENSION_ACTIVITY } from './extension-activity.ts'

export const STATE_FORM_WORKFLOW_SECRETS = '{c4d1f7a2-0073-4e6b-8a15-3f9e2b7d0073}'

export const formWorkflowSecretsMigration: Migration = {
  from: STATE_EXTENSION_ACTIVITY,
  to: STATE_FORM_WORKFLOW_SECRETS,
  name: 'AddFormWorkflowSecrets',
  kind: 'expand',
  release: '0.62.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('form_workflow_secret')
      .addColumn('form_key', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('workflow_key', sql.raw(t.varchar(64)), (c) => c.notNull())
      .addColumn('header', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('sealed', sql.raw(t.text), (c) => c.notNull())
      .addColumn('url', sql.raw(t.text), (c) => c.notNull())
      .addColumn('set_by', sql.raw(t.varchar(255)))
      .addColumn('set_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addPrimaryKeyConstraint('form_workflow_secret_pk', ['form_key', 'workflow_key', 'header'])
      .execute()
  },
}
