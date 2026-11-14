/**
 * Migration 077 — a back-office session viewing as user groups (story 314):
 * the groups' keys, as JSON, and when the view ends. Both null when the
 * session is its user's own.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_USER_START_NODES_DROPPED } from './user-start-nodes-dropped.ts'

export const STATE_SESSION_VIEW_AS = '{7b1d4e62-0077-4a39-9c85-2f6e0d3a0077}'

export const sessionViewAsMigration: Migration = {
  from: STATE_USER_START_NODES_DROPPED,
  to: STATE_SESSION_VIEW_AS,
  name: 'AddSessionViewAs',
  kind: 'expand',
  release: '0.65.1',
  async up(db: Db) {
    const t = db.dialect.types
    await schemaOps(db).addColumn('user_login_session', 'view_as_groups', t.text)
    await schemaOps(db).addColumn('user_login_session', 'view_as_until', t.timestamp)
  },
}
