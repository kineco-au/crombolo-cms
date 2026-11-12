/**
 * Migration 076 — a user's own start nodes are dropped (story 339): where a user
 * may work comes only from their groups.
 *
 * A user's own start nodes replaced any group start node they overlapped, so
 * they usually narrowed someone; without them that user reaches what their
 * groups do. Nothing converts them faithfully, so each one is named on the
 * Changes dashboard and in the audit log, where the user had been held, before
 * the table goes. Statements only, never a read, so the upgrade can be planned.
 */
import type { Kysely } from 'kysely'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_PRUNED_PERMISSIONS } from './pruned-permissions.ts'

export const STATE_USER_START_NODES_DROPPED = '{3c7e2a90-0076-4f1b-8d64-1a5e9b2c0076}'

export const userStartNodesDroppedMigration: Migration = {
  from: STATE_PRUNED_PERMISSIONS,
  to: STATE_USER_START_NODES_DROPPED,
  name: 'DropUserStartNodes',
  kind: 'expand',
  release: '0.63.0',
  async up(db: Db) {
    // Untyped: the table is gone from the generated types once this runs.
    const old = db.q as unknown as Kysely<Record<string, Record<string, unknown>>>
    // Cast: a bare parameter in a select is text, which Postgres won't put in a timestamp.
    const now = sql`CAST(${DbDate.toDb(new Date())} AS ${sql.raw(db.dialect.types.timestamp)})`
    // "all media", or "pages under News": where this row held the user.
    const place = sql<string>`(CASE WHEN s.start_node = -1 THEN 'all ' ELSE '' END)
      || (CASE s.start_node_type WHEN 1 THEN 'pages' WHEN 2 THEN 'media' ELSE 'Library items' END)
      || (CASE WHEN s.start_node = -1 THEN '' ELSE ' under ' || COALESCE(n.text, 'a removed item') END)`
    const rows = () =>
      old
        .selectFrom('user_start_node as s')
        .innerJoin('user_account as u', 'u.id', 's.user_id')
        .leftJoin('node as n', 'n.id', 's.start_node')

    await old
      .insertInto('change_report')
      .columns([
        'run_id',
        'source',
        'scope',
        'status',
        'kind',
        'code',
        'subject_type',
        'subject_key',
        'subject_name',
        'property_alias',
        'culture',
        'message',
        'link',
        'first_seen',
        'last_seen',
      ])
      .expression((eb) =>
        rows().select([
          eb.val('migration-076').as('run_id'),
          eb.val('upgrade').as('source'),
          eb.val('user-start-nodes').as('scope'),
          eb.val('open').as('status'),
          eb.val('person').as('kind'),
          eb.val('user-start-nodes-dropped').as('code'),
          eb.val('user').as('subject_type'),
          'u.key',
          'u.user_name',
          sql`NULL`.as('property_alias'),
          sql`NULL`.as('culture'),
          sql<string>`u.user_name || ' was held to ' || ${place} || '. A user''s own start nodes are gone, so they now work wherever their groups do. Put them in a group that reaches only there if that was meant.'`.as(
            'message',
          ),
          sql<string>`'section/user-management/workspace/user/edit/' || u.key`.as('link'),
          now.as('first_seen'),
          now.as('last_seen'),
        ]),
      )
      .execute()

    await old
      .insertInto('audit_entry')
      .columns([
        'category',
        'action',
        'entity_type',
        'entity_key',
        'entity_name',
        'detail',
        'source',
        'user_key',
        'user_name',
        'ip_address',
        'forwarded_for',
        'occurred_at',
      ])
      .expression((eb) =>
        rows().select([
          eb.val('permission').as('category'),
          eb.val('StartNodesDropped').as('action'),
          eb.val('User').as('entity_type'),
          'u.key',
          'u.user_name',
          sql<string>`'own start node dropped on upgrade (story 339): was held to ' || ${place}`.as(
            'detail',
          ),
          eb.val('boot').as('source'),
          sql`NULL`.as('user_key'),
          eb.val('crombolo').as('user_name'),
          sql`NULL`.as('ip_address'),
          sql`NULL`.as('forwarded_for'),
          now.as('occurred_at'),
        ]),
      )
      .execute()

    await db.q.schema.dropTable('user_start_node').execute()
  },
}
