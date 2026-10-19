/**
 * Migration 044 — `approval_request.schedule`: when a request asked to publish
 * or take the page down, per culture (story 029). Requests from before it have
 * none and publish on approval, as they always did. docs/workflows.md.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_CONTENT_NOTIFICATIONS } from './content-notifications.ts'

export const STATE_APPROVAL_SCHEDULES = '{3c9e5b17-0044-4a2d-8f61-7b0d4e2a9c44}'

export const approvalSchedulesMigration: Migration = {
  from: STATE_CONTENT_NOTIFICATIONS,
  to: STATE_APPROVAL_SCHEDULES,
  name: 'AddApprovalSchedules',
  kind: 'expand',
  release: '0.20.0',
  async up(db: Db) {
    await schemaOps(db).addColumn('approval_request', 'schedule', db.dialect.types.text)
  },
}
