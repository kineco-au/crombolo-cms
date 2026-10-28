/**
 * Who may read and change media (story 196): a rule on a folder or item, and
 * each item's own policies and creator. docs/media.md, "Protected media".
 *
 * Rules are few — one per folder given permissions — so the nearest one is
 * found from `node.path`, as `PublicAccessRepository.entryFor` finds a page's.
 * An item's settings are columns on its `content` row, so a library of
 * millions of files holds no rule rows for them.
 */
import {
  type DocumentAggregate,
  type DocumentValue,
  FILE_VALUE_EDITORS,
  type MediaItemAccess,
  type MediaPolicy,
  type MediaRule,
  mediaFileOf,
  NEW_MEDIA_READ,
  NEW_MEDIA_WRITE,
  type NewMediaRead,
  type NewMediaWrite,
  normaliseUuid,
  ObjectTypes,
  parseMediaPolicy,
  stampedPolicies,
} from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { NodeRepository, type NodeRow } from './nodes.ts'

export interface MediaAccessGroup {
  name: string
  read: boolean
  write: boolean
}

/** A rule as it is set on one folder or item. */
export interface MediaAccessInput {
  nodeKey: string
  publicRead: boolean
  groups: readonly MediaAccessGroup[]
  newRead: NewMediaRead | null
  newWrite: NewMediaWrite | null
  /** File types a member may upload below (story 198); none when absent. */
  memberTypes?: readonly string[]
  memberMaxBytes?: number | null
}

export interface MediaAccessEntry extends MediaAccessInput {
  nodeId: number
  groups: MediaAccessGroup[]
  memberTypes: string[]
  memberMaxBytes: number | null
}

/** The item a `/media/…` path names, with what decides who may read it. */
export interface MediaByUrl {
  id: number
  key: string
  path: string
  trashed: boolean
  access: MediaItemAccess
  rule: MediaRule | undefined
}

/** A rule in the shape `memberMay` reads. Pure. */
export const ruleOf = (entry: MediaAccessEntry): MediaRule => ({
  nodeId: entry.nodeId,
  publicRead: entry.publicRead,
  readGroups: entry.groups.filter((g) => g.read).map((g) => g.name),
  writeGroups: entry.groups.filter((g) => g.write).map((g) => g.name),
  newRead: entry.newRead,
  newWrite: entry.newWrite,
  memberTypes: entry.memberTypes,
  memberMaxBytes: entry.memberMaxBytes,
})

/** A stored list of member file types: lowercase names, each once. Pure. */
export const memberTypesOf = (value: unknown): string[] =>
  typeof value === 'string'
    ? [
        ...new Set(
          value
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : []

const storedTypes = (types: readonly string[] | undefined): string | null => {
  const list = memberTypesOf((types ?? []).join(','))
  return list.length > 0 ? list.join(',') : null
}
const storedBytes = (bytes: number | null | undefined): number | null =>
  typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes) : null

const newRead = (value: unknown): NewMediaRead | null =>
  NEW_MEDIA_READ.includes(value as NewMediaRead) ? (value as NewMediaRead) : null
const newWrite = (value: unknown): NewMediaWrite | null =>
  NEW_MEDIA_WRITE.includes(value as NewMediaWrite) ? (value as NewMediaWrite) : null

/** An item's own settings from its `content` columns; null policies are `inherit`. */
export const itemAccessOf = (row: Record<string, unknown>): MediaItemAccess => ({
  readPolicy: parseMediaPolicy(row.read_policy),
  writePolicy: parseMediaPolicy(row.write_policy),
  creatorMemberKey: row.creator_member_key ? normaliseUuid(String(row.creator_member_key)) : null,
})

const stored = (policy: MediaPolicy): string | null => (policy === 'inherit' ? null : policy)

/** The `/media/…` paths a node's upload and image cropper values name. Pure. */
export function filesOf(values: readonly DocumentValue[]): string[] {
  const urls = new Set<string>()
  for (const value of values) {
    if (!value.editorAlias || !FILE_VALUE_EDITORS.has(value.editorAlias)) continue
    const file = mediaFileOf({ values: [{ ...value, alias: 'umbracoFile' }] })
    if (file) urls.add(file)
  }
  return [...urls]
}

/**
 * Records where a node's files are served, so `/media/…` serves only files
 * something owns: a media item's on its `content` row, anything else's — a
 * page's upload field — in `node_file`.
 */
export async function recordFiles(
  db: Db,
  kind: string,
  nodeId: number,
  aggregate: Pick<DocumentAggregate, 'values'>,
): Promise<void> {
  if (kind === 'media') {
    await db.exec('UPDATE content SET file_url = ? WHERE node_id = ?', [
      mediaFileOf(aggregate),
      nodeId,
    ])
    return
  }
  await db.exec('DELETE FROM node_file WHERE node_id = ?', [nodeId])
  for (const url of filesOf(aggregate.values))
    await db.exec('INSERT INTO node_file (node_id, url) VALUES (?, ?)', [nodeId, url])
}

interface EntryRow {
  id: number
  node_id: number
  node_key: string
  public_read: unknown
  new_read: string | null
  new_write: string | null
  member_types: string | null
  member_max_bytes: unknown
}

const SELECT = `SELECT a.id, a.node_id, n.unique_id AS node_key, a.public_read, a.new_read, a.new_write,
       a.member_types, a.member_max_bytes
    FROM media_access a JOIN node n ON n.id = a.node_id`

export class MediaAccessRepository {
  #db: Db
  #nodes: NodeRepository

  constructor(db: Db) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
  }

  async #media(key: string): Promise<NodeRow | undefined> {
    const node = await this.#nodes.byKey(key)
    return node && node.objectType === ObjectTypes.Media ? node : undefined
  }

  async #hydrate(rows: readonly EntryRow[]): Promise<MediaAccessEntry[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => Number(row.id))
    const groups = await this.#db.query<{
      media_access_id: number
      member_group: string
      can_read: unknown
      can_write: unknown
    }>(
      `SELECT media_access_id, member_group, can_read, can_write FROM media_access_rule
        WHERE media_access_id IN (${ids.map(() => '?').join(', ')}) ORDER BY member_group`,
      ids,
    )
    return rows.map((row) => ({
      nodeId: Number(row.node_id),
      nodeKey: normaliseUuid(String(row.node_key)),
      publicRead: fromDbBool(row.public_read),
      newRead: newRead(row.new_read),
      newWrite: newWrite(row.new_write),
      memberTypes: memberTypesOf(row.member_types),
      memberMaxBytes: storedBytes(
        row.member_max_bytes === null || row.member_max_bytes === undefined
          ? null
          : Number(row.member_max_bytes),
      ),
      groups: groups
        .filter((g) => Number(g.media_access_id) === Number(row.id))
        .map((g) => ({
          name: String(g.member_group),
          read: fromDbBool(g.can_read),
          write: fromDbBool(g.can_write),
        })),
    }))
  }

  /** Every rule, in two queries: what a request deciding over many items reads. */
  async allRules(): Promise<MediaRule[]> {
    const rows = await this.#db.query<EntryRow>(SELECT)
    return (await this.#hydrate(rows)).map(ruleOf)
  }

  /** The rule set on this folder or item itself, if any. */
  async byNodeKey(nodeKey: string): Promise<MediaAccessEntry | undefined> {
    const rows = await this.#db.query<EntryRow>(`${SELECT} WHERE n.unique_id = ?`, [
      normaliseUuid(nodeKey),
    ])
    return (await this.#hydrate(rows))[0]
  }

  /**
   * The rule that governs a node: its own, else its nearest ancestor's;
   * `above` skips its own, as for the defaults a new file is given.
   */
  async ruleFor(
    nodeKey: string,
    options: { above?: boolean } = {},
  ): Promise<MediaAccessEntry | undefined> {
    const node = await this.#nodes.byKey(nodeKey)
    return node ? this.#nearest(node.path, options.above ? node.id : undefined) : undefined
  }

  async #nearest(path: string, skip?: number): Promise<MediaAccessEntry | undefined> {
    const ids = path
      .split(',')
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0 && id !== skip)
    if (ids.length === 0) return undefined
    const rows = await this.#db.query<EntryRow>(
      `${SELECT} WHERE a.node_id IN (${ids.map(() => '?').join(', ')}) ORDER BY n.level DESC LIMIT 1`,
      ids,
    )
    return (await this.#hydrate(rows))[0]
  }

  /** Sets the rule on a media folder or item, replacing any; undefined when it is not media. */
  async save(input: MediaAccessInput): Promise<MediaAccessEntry | undefined> {
    const node = await this.#media(input.nodeKey)
    if (!node) return undefined
    const now = DbDate.toDb(new Date())
    await this.#db.transaction(async (tx) => {
      const existing = await tx.query<{ id: number }>(
        'SELECT id FROM media_access WHERE node_id = ?',
        [node.id],
      )
      let id = existing[0] ? Number(existing[0].id) : undefined
      const values = [
        tx.dialect.boolValue(input.publicRead),
        input.newRead,
        input.newWrite,
        storedTypes(input.memberTypes),
        storedBytes(input.memberMaxBytes),
      ]
      if (id === undefined) {
        await tx.exec(
          `INSERT INTO media_access (node_id, public_read, new_read, new_write, member_types, member_max_bytes, create_date, update_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [node.id, ...values, now, now],
        )
        const created = await tx.query<{ id: number }>(
          'SELECT id FROM media_access WHERE node_id = ?',
          [node.id],
        )
        id = Number(created[0]?.id)
      } else {
        await tx.exec(
          `UPDATE media_access SET public_read = ?, new_read = ?, new_write = ?, member_types = ?,
             member_max_bytes = ?, update_date = ? WHERE id = ?`,
          [...values, now, id],
        )
        await tx.exec('DELETE FROM media_access_rule WHERE media_access_id = ?', [id])
      }
      const seen = new Set<string>()
      for (const group of input.groups) {
        const name = group.name.trim()
        if (name === '' || seen.has(name.toLowerCase()) || (!group.read && !group.write)) continue
        seen.add(name.toLowerCase())
        await tx.exec(
          'INSERT INTO media_access_rule (media_access_id, member_group, can_read, can_write) VALUES (?, ?, ?, ?)',
          [id, name, tx.dialect.boolValue(group.read), tx.dialect.boolValue(group.write)],
        )
      }
    })
    return this.byNodeKey(input.nodeKey)
  }

  /** Takes the rule off a folder or item, which then follows the one above it. */
  async remove(nodeKey: string): Promise<boolean> {
    const own = await this.byNodeKey(nodeKey)
    if (!own) return false
    await this.#db.transaction(async (tx) => {
      await tx.exec(
        'DELETE FROM media_access_rule WHERE media_access_id IN (SELECT id FROM media_access WHERE node_id = ?)',
        [own.nodeId],
      )
      await tx.exec('DELETE FROM media_access WHERE node_id = ?', [own.nodeId])
    })
    return true
  }

  /** An item's own settings; undefined when it is not media. */
  async itemAccess(nodeKey: string): Promise<MediaItemAccess | undefined> {
    const rows = await this.#db.query(
      `SELECT c.read_policy, c.write_policy, c.creator_member_key
         FROM content c JOIN node n ON n.id = c.node_id
        WHERE n.unique_id = ? AND n.node_object_type = ?`,
      [normaliseUuid(nodeKey), ObjectTypes.Media],
    )
    return rows[0] ? itemAccessOf(rows[0]) : undefined
  }

  /** Sets who may see and change an item itself; false when it is not media. */
  async setItemAccess(
    nodeKey: string,
    policies: { readPolicy: MediaPolicy; writePolicy: MediaPolicy },
  ): Promise<boolean> {
    const node = await this.#media(nodeKey)
    if (!node) return false
    await this.#db.exec('UPDATE content SET read_policy = ?, write_policy = ? WHERE node_id = ?', [
      stored(policies.readPolicy),
      stored(policies.writePolicy),
      node.id,
    ])
    return true
  }

  /** Records the member who created an item; null clears it. */
  async setCreator(nodeKey: string, memberKey: string | null): Promise<boolean> {
    const node = await this.#media(nodeKey)
    if (!node) return false
    await this.#db.exec('UPDATE content SET creator_member_key = ? WHERE node_id = ?', [
      memberKey ? normaliseUuid(memberKey) : null,
      node.id,
    ])
    return true
  }

  /**
   * Gives a new item the policies the nearest rule above it sets for new
   * files, and records its creator when a member made it.
   */
  async stampNew(
    nodeKey: string,
    creatorMemberKey: string | null = null,
  ): Promise<MediaItemAccess | undefined> {
    const node = await this.#media(nodeKey)
    if (!node) return undefined
    const above = await this.#nearest(node.path, node.id)
    const policies = stampedPolicies(above ? ruleOf(above) : undefined)
    const creator = creatorMemberKey ? normaliseUuid(creatorMemberKey) : null
    await this.#db.exec(
      'UPDATE content SET read_policy = ?, write_policy = ?, creator_member_key = ? WHERE node_id = ?',
      [stored(policies.readPolicy), stored(policies.writePolicy), creator, node.id],
    )
    return { ...policies, creatorMemberKey: creator }
  }

  /**
   * The item whose file is served at a `/media/…` path, its settings and the
   * nearest rule, through the `file_url` index; undefined when none owns it.
   * Two queries: the item with its rule's id, then that rule.
   */
  async byUrl(urls: string | readonly string[]): Promise<MediaByUrl | undefined> {
    const wanted = [...new Set(typeof urls === 'string' ? [urls] : urls)]
    if (wanted.length === 0) return undefined
    const rows = await this.#db.query(
      `SELECT n.id, n.unique_id, n.path, n.trashed, c.read_policy, c.write_policy, c.creator_member_key,
              (SELECT a.id FROM media_access a JOIN node an ON an.id = a.node_id
                WHERE (',' || n.path || ',') LIKE ('%,' || CAST(a.node_id AS VARCHAR(20)) || ',%')
                ORDER BY an.level DESC LIMIT 1) AS rule_id
         FROM content c JOIN node n ON n.id = c.node_id
        WHERE c.file_url IN (${wanted.map(() => '?').join(', ')}) AND n.node_object_type = ?
        ORDER BY n.id LIMIT 1`,
      [...wanted, ObjectTypes.Media],
    )
    const row = rows[0]
    if (!row) return undefined
    const ruleRows =
      row.rule_id === null || row.rule_id === undefined
        ? []
        : await this.#db.query<EntryRow>(`${SELECT} WHERE a.id = ?`, [Number(row.rule_id)])
    const entry = (await this.#hydrate(ruleRows))[0]
    return {
      id: Number(row.id),
      key: normaliseUuid(String(row.unique_id)),
      path: String(row.path),
      trashed: fromDbBool(row.trashed),
      access: itemAccessOf(row),
      rule: entry ? ruleOf(entry) : undefined,
    }
  }

  /**
   * Whether something other than a media item owns this file — a page's,
   * element's or member's upload value, or a back-office user's avatar — and
   * so is served as before.
   */
  async ownedElsewhere(urls: readonly string[]): Promise<boolean> {
    if (urls.length === 0) return false
    const holes = urls.map(() => '?').join(', ')
    const rows = await this.#db.query(
      `SELECT node_id FROM node_file WHERE url IN (${holes})
       UNION ALL SELECT id FROM user_account WHERE avatar IN (${holes})`,
      [...urls, ...urls],
    )
    return rows.length > 0
  }

  /** Every media item that says something of its own, by node id: for the published cache. */
  async itemSettings(): Promise<Map<number, MediaItemAccess>> {
    const rows = await this.#db.query(
      `SELECT c.node_id, c.read_policy, c.write_policy, c.creator_member_key
         FROM content c JOIN node n ON n.id = c.node_id
        WHERE n.node_object_type = ?
          AND (c.read_policy IS NOT NULL OR c.write_policy IS NOT NULL OR c.creator_member_key IS NOT NULL)`,
      [ObjectTypes.Media],
    )
    return new Map(rows.map((row) => [Number(row.node_id), itemAccessOf(row)]))
  }
}
