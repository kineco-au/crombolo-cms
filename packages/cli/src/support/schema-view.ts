/**
 * The site's database's side of `types list` and `types show` (story 247): what
 * is applied, and how many items use each type. Read only, and only from a
 * database that already exists: reading a site never creates one.
 */
import { existsSync } from 'node:fs'
import { ObjectTypes } from '@crombolo/core'
import { connect, type Db } from '@crombolo/data'
import {
  type DescribedKind,
  exportSchemaSet,
  type SchemaContentType,
  type SchemaDataType,
  type SchemaSet,
  writeContentType,
  writeDataType,
  writeMediaType,
  writeMemberType,
} from '@crombolo/schema'
import type { CromboloConfig } from '@crombolo/server'

/** Whether a definition in the files is what the database has. */
export type AppliedState = 'applied' | 'not applied yet' | 'changed, not applied yet'

export interface AppliedSchema {
  set: SchemaSet
  /** Items of each type, by `kind:alias`; trashed ones left out. */
  items: Map<string, number>
}

const KIND_OF_OBJECT: Record<string, Exclude<DescribedKind, 'data' | 'element'>> = {
  [ObjectTypes.DocumentType]: 'content',
  [ObjectTypes.MediaType]: 'media',
  [ObjectTypes.MemberType]: 'member',
}

/** The kind's key for counts: elements are content types to the database. */
const countKey = (kind: DescribedKind, alias: string) =>
  `${kind === 'element' ? 'content' : kind}:${alias.toLowerCase()}`

/** Items of each type, in one grouped query. */
async function itemCounts(db: Db): Promise<Map<string, number>> {
  const rows = await db.q
    .selectFrom('content as c')
    .innerJoin('node as n', 'n.id', 'c.node_id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .innerJoin('node as ctn', 'ctn.id', 'ct.node_id')
    .select((eb) => ['ct.alias', 'ctn.node_object_type', eb.fn.countAll().as('n')])
    .where('n.trashed', '=', db.dialect.boolValue(false))
    .groupBy(['ct.alias', 'ctn.node_object_type'])
    .execute()
  const counts = new Map<string, number>()
  for (const row of rows) {
    const kind = KIND_OF_OBJECT[String(row.node_object_type)]
    if (kind) counts.set(countKey(kind, String(row.alias)), Number(row.n))
  }
  return counts
}

/**
 * The applied definitions and item counts, or why there are none: no database
 * yet, or one that cannot be read as it stands. Never creates or migrates one.
 */
export async function appliedSchema(
  config: CromboloConfig,
  version: string,
): Promise<AppliedSchema | { unavailable: string }> {
  if (
    config.dialect === 'sqlite' &&
    config.sqliteFile !== ':memory:' &&
    !existsSync(config.sqliteFile)
  )
    return { unavailable: 'the site has no database yet' }
  let db: Db
  try {
    db = await connect({ dialect: config.dialect, file: config.sqliteFile })
  } catch (error) {
    return { unavailable: `the site's database could not be opened: ${String(error)}` }
  }
  try {
    return { set: await exportSchemaSet(db, version), items: await itemCounts(db) }
  } catch {
    return { unavailable: "the site's database does not have its definitions yet" }
  } finally {
    await db.close()
  }
}

export const itemsOf = (applied: AppliedSchema, kind: DescribedKind, alias: string) =>
  kind === 'data' ? null : (applied.items.get(countKey(kind, alias)) ?? 0)

/** A definition without the keys a file may leave out, for comparing as written. */
function keyless<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (name, inner) => (name === 'key' ? undefined : inner)))
}

function written(kind: DescribedKind, definition: SchemaContentType | SchemaDataType): string {
  if (kind === 'data') return writeDataType(keyless(definition as SchemaDataType))
  const type = keyless(definition as SchemaContentType)
  if (kind === 'media') return writeMediaType(type)
  if (kind === 'member') return writeMemberType(type)
  return writeContentType(type, 'document')
}

function find(set: SchemaSet, kind: DescribedKind, alias: string) {
  const wanted = alias.toLowerCase()
  const match = <T extends { alias: string }>(list: readonly T[] | undefined) =>
    list?.find((item) => item.alias.toLowerCase() === wanted)
  if (kind === 'data') return match(set.dataTypes)
  if (kind === 'media') return match(set.mediaTypes)
  if (kind === 'member') return match(set.memberTypes)
  return match(set.contentTypes)
}

/** Whether a definition in the files is applied: absent, different, or the same. */
export function appliedStateOf(
  files: SchemaSet,
  applied: AppliedSchema,
  kind: DescribedKind,
  alias: string,
): AppliedState {
  // Not one of the site's own: a built-in data type, which every database has.
  const here = find(files, kind, alias)
  if (!here) return 'applied'
  const there = find(applied.set, kind, alias)
  if (!there) return 'not applied yet'
  return written(kind, here) === written(kind, there) ? 'applied' : 'changed, not applied yet'
}
