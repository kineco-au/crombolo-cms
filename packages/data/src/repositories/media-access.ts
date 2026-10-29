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
import { sql } from '../query.ts'
import { NodeRepository, type NodeRow } from './nodes.ts'

export interface MediaAccessGroup {
  name: string
  read: boolean
  write: boolean
}

export interface MediaAccessMember {
  key: string
  read: boolean
  write: boolean
}

/** A rule as it is set on one folder or item. */
export interface MediaAccessInput {
  nodeKey: string
  publicRead: boolean
  groups: readonly MediaAccessGroup[]
  members?: readonly MediaAccessMember[]
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
  readMembers: entry.members?.filter((m) => m.read).map((m) => m.key),
  writeMembers: entry.members?.filter((m) => m.write).map((m) => m.key),
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
    await db.q
      .updateTable('content')
      .set({ file_url: mediaFileOf(aggregate) })
      .where('node_id', '=', nodeId)
      .execute()
    return
  }
  await db.q.deleteFrom('node_file').where('node_id', '=', nodeId).execute()
  for (const url of filesOf(aggregate.values))
    await db.q.insertInto('node_file').values({ node_id: nodeId, url }).execute()
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

const entries = (db: Db) =>
  db.q
    .selectFrom('media_access as a')
    .innerJoin('node as n', 'n.id', 'a.node_id')
    .select([
      'a.id',
      'a.node_id',
      'n.unique_id as node_key',
      'a.public_read',
      'a.new_read',
      'a.new_write',
      'a.member_types',
      'a.member_max_bytes',
    ])

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
    const groups = await this.#db.q
      .selectFrom('media_access_rule')
      .select(['media_access_id', 'member_group', 'can_read', 'can_write'])
      .where('media_access_id', 'in', ids)
      .orderBy('member_group')
      .execute()
    const members = await this.#db.q
      .selectFrom('media_access_member')
      .select(['media_access_id', 'member_key', 'can_read', 'can_write'])
      .where('media_access_id', 'in', ids)
      .orderBy('member_key')
      .execute()
    return rows.map((row) => ({
      ...(members.some((m) => Number(m.media_access_id) === Number(row.id))
        ? {
            members: members
              .filter((m) => Number(m.media_access_id) === Number(row.id))
              .map((m) => ({
                key: normaliseUuid(m.member_key),
                read: fromDbBool(m.can_read),
                write: fromDbBool(m.can_write),
              })),
          }
        : {}),
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

  /** Every rule, in three queries: what a request deciding over many items reads. */
  async allRules(): Promise<MediaRule[]> {
    const rows = await entries(this.#db).execute()
    return (await this.#hydrate(rows)).map(ruleOf)
  }

  /** The rule set on this folder or item itself, if any. */
  async byNodeKey(nodeKey: string): Promise<MediaAccessEntry | undefined> {
    const rows = await entries(this.#db).where('n.unique_id', '=', normaliseUuid(nodeKey)).execute()
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
    const rows = await entries(this.#db)
      .where('a.node_id', 'in', ids)
      .orderBy('n.level', 'desc')
      .limit(1)
      .execute()
    return (await this.#hydrate(rows))[0]
  }

  /** Sets the rule on a media folder or item, replacing any; undefined when it is not media. */
  async save(input: MediaAccessInput): Promise<MediaAccessEntry | undefined> {
    const node = await this.#media(input.nodeKey)
    if (!node) return undefined
    const now = DbDate.toDb(new Date())
    await this.#db.transaction(async (tx) => {
      const existing = await tx.q
        .selectFrom('media_access')
        .select('id')
        .where('node_id', '=', node.id)
        .executeTakeFirst()
      let id = existing ? Number(existing.id) : undefined
      const values = {
        public_read: tx.dialect.boolValue(input.publicRead) as boolean | number,
        new_read: input.newRead,
        new_write: input.newWrite,
        member_types: storedTypes(input.memberTypes),
        member_max_bytes: storedBytes(input.memberMaxBytes),
      }
      if (id === undefined) {
        await tx.q
          .insertInto('media_access')
          .values({ node_id: node.id, ...values, create_date: now, update_date: now })
          .execute()
        const created = await tx.q
          .selectFrom('media_access')
          .select('id')
          .where('node_id', '=', node.id)
          .executeTakeFirst()
        id = Number(created?.id)
      } else {
        await tx.q
          .updateTable('media_access')
          .set({ ...values, update_date: now })
          .where('id', '=', id)
          .execute()
        await tx.q.deleteFrom('media_access_rule').where('media_access_id', '=', id).execute()
      }
      const seen = new Set<string>()
      await tx.q.deleteFrom('media_access_member').where('media_access_id', '=', id).execute()
      const memberKeys = new Set<string>()
      for (const member of input.members ?? []) {
        const key = normaliseUuid(member.key)
        if (memberKeys.has(key) || (!member.read && !member.write)) continue
        memberKeys.add(key)
        await tx.q
          .insertInto('media_access_member')
          .values({
            media_access_id: id,
            member_key: key,
            can_read: tx.dialect.boolValue(member.read) as boolean | number,
            can_write: tx.dialect.boolValue(member.write) as boolean | number,
          })
          .execute()
      }
      for (const group of input.groups) {
        const name = group.name.trim()
        if (name === '' || seen.has(name.toLowerCase()) || (!group.read && !group.write)) continue
        seen.add(name.toLowerCase())
        await tx.q
          .insertInto('media_access_rule')
          .values({
            media_access_id: id,
            member_group: name,
            can_read: tx.dialect.boolValue(group.read) as boolean | number,
            can_write: tx.dialect.boolValue(group.write) as boolean | number,
          })
          .execute()
      }
    })
    return this.byNodeKey(input.nodeKey)
  }

  /** Takes the rule off a folder or item, which then follows the one above it. */
  async remove(nodeKey: string): Promise<boolean> {
    const own = await this.byNodeKey(nodeKey)
    if (!own) return false
    await this.#db.transaction(async (tx) => {
      await tx.q
        .deleteFrom('media_access_rule')
        .where('media_access_id', 'in', (eb) =>
          eb.selectFrom('media_access').select('id').where('node_id', '=', own.nodeId),
        )
        .execute()
      await tx.q.deleteFrom('media_access').where('node_id', '=', own.nodeId).execute()
    })
    return true
  }

  /** An item's own settings; undefined when it is not media. */
  async itemAccess(nodeKey: string): Promise<MediaItemAccess | undefined> {
    const row = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('node as n', 'n.id', 'c.node_id')
      .select(['c.read_policy', 'c.write_policy', 'c.creator_member_key'])
      .where('n.unique_id', '=', normaliseUuid(nodeKey))
      .where('n.node_object_type', '=', ObjectTypes.Media)
      .executeTakeFirst()
    return row ? itemAccessOf(row) : undefined
  }

  /** Sets who may see and change an item itself; false when it is not media. */
  async setItemAccess(
    nodeKey: string,
    policies: { readPolicy: MediaPolicy; writePolicy: MediaPolicy },
  ): Promise<boolean> {
    const node = await this.#media(nodeKey)
    if (!node) return false
    await this.#db.q
      .updateTable('content')
      .set({ read_policy: stored(policies.readPolicy), write_policy: stored(policies.writePolicy) })
      .where('node_id', '=', node.id)
      .execute()
    return true
  }

  /** Records the member who created an item; null clears it. */
  async setCreator(nodeKey: string, memberKey: string | null): Promise<boolean> {
    const node = await this.#media(nodeKey)
    if (!node) return false
    await this.#db.q
      .updateTable('content')
      .set({ creator_member_key: memberKey ? normaliseUuid(memberKey) : null })
      .where('node_id', '=', node.id)
      .execute()
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
    await this.#db.q
      .updateTable('content')
      .set({
        read_policy: stored(policies.readPolicy),
        write_policy: stored(policies.writePolicy),
        creator_member_key: creator,
      })
      .where('node_id', '=', node.id)
      .execute()
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
    const row = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('node as n', 'n.id', 'c.node_id')
      .select((eb) => [
        'n.id',
        'n.unique_id',
        'n.path',
        'n.trashed',
        'c.read_policy',
        'c.write_policy',
        'c.creator_member_key',
        eb
          .selectFrom('media_access as a')
          .innerJoin('node as an', 'an.id', 'a.node_id')
          .select('a.id')
          .where(
            (inner) =>
              sql<boolean>`(',' || ${inner.ref('n.path')} || ',') like ('%,' || cast(${inner.ref('a.node_id')} as varchar(20)) || ',%')`,
          )
          .orderBy('an.level', 'desc')
          .limit(1)
          .as('rule_id'),
      ])
      .where('c.file_url', 'in', wanted)
      .where('n.node_object_type', '=', ObjectTypes.Media)
      .orderBy('n.id')
      .limit(1)
      .executeTakeFirst()
    if (!row) return undefined
    const ruleRows =
      row.rule_id === null || row.rule_id === undefined
        ? []
        : await entries(this.#db).where('a.id', '=', Number(row.rule_id)).execute()
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
    const rows = await this.#db.q
      .selectFrom('node_file')
      .select('node_id')
      .where('url', 'in', urls)
      .unionAll((eb) =>
        eb.selectFrom('user_account').select('id as node_id').where('avatar', 'in', urls),
      )
      .execute()
    return rows.length > 0
  }

  /** Every media item that says something of its own, by node id: for the published cache. */
  async itemSettings(): Promise<Map<number, MediaItemAccess>> {
    const rows = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('node as n', 'n.id', 'c.node_id')
      .select(['c.node_id', 'c.read_policy', 'c.write_policy', 'c.creator_member_key'])
      .where('n.node_object_type', '=', ObjectTypes.Media)
      .where((eb) =>
        eb.or([
          eb('c.read_policy', 'is not', null),
          eb('c.write_policy', 'is not', null),
          eb('c.creator_member_key', 'is not', null),
        ]),
      )
      .execute()
    return new Map(rows.map((row) => [Number(row.node_id), itemAccessOf(row)]))
  }
}
