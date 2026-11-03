/**
 * What the languages, user groups and URL commands share (story 251): the site's
 * definitions, the database's side of them when one exists, and moving a
 * group's users. Reading never creates a database.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_GROUP_ALIAS } from '@crombolo/core'
import {
  connect,
  type Db,
  LanguageRepository,
  type UserGroupRecord,
  UserGroupRepository,
  UserRepository,
} from '@crombolo/data'
import { fileNameFor, type SchemaUserGroup } from '@crombolo/schema'
import { bootstrapDatabase, type CromboloConfig } from '@crombolo/server'
import { CliError } from '../errors.ts'
import { siteConfig } from './site.ts'
import { loadTypes, needSchemaDir, refuseProblems } from './types.ts'

/** The site's config and definitions, refused when they do not load. */
export async function siteDefinitions() {
  const config = await siteConfig()
  needSchemaDir(config)
  const loaded = loadTypes(config)
  refuseProblems(loaded.problems, config.schemaDir)
  return { config, loaded }
}

/** The site's database when it already exists, for `work`; undefined otherwise. */
export async function withExisting<T>(
  config: CromboloConfig,
  work: (db: Db) => Promise<T>,
): Promise<T | undefined> {
  if (
    config.dialect === 'sqlite' &&
    config.sqliteFile !== ':memory:' &&
    !existsSync(config.sqliteFile)
  )
    return undefined
  let db: Db
  try {
    db = await connect({ dialect: config.dialect, file: config.sqliteFile })
  } catch {
    return undefined
  }
  try {
    return await work(db)
  } catch {
    return undefined
  } finally {
    await db.close()
  }
}

/** The site's database, made and brought up to date if need be, for a change. */
export async function withDatabase<T>(
  config: CromboloConfig,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  const { db } = await bootstrapDatabase(config)
  try {
    return await work(db)
  } finally {
    await db.close()
  }
}

/** How many pages have a version in a language, which removing it would delete. */
export async function pagesIn(db: Db, iso: string): Promise<number> {
  const language = await new LanguageRepository(db).byIso(iso)
  if (!language) return 0
  const rows = await db.q
    .selectFrom('document_culture_variation as v')
    .innerJoin('language as l', 'l.id', 'v.language_id')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('l.iso_code', '=', language.isoCode)
    .execute()
  return Number(rows[0]?.n ?? 0)
}

export const groupFile = (config: CromboloConfig, files: Map<string, string>, alias: string) =>
  files.get(`user-group:${alias}`) ?? join(config.schemaDir, 'user-groups', fileNameFor(alias))

/** A group as the site's files would declare it, from the database's record of it. */
export const asDeclared = (record: UserGroupRecord): SchemaUserGroup => ({
  alias: record.alias,
  name: record.name,
  ...(record.description ? { description: record.description } : {}),
  ...(record.icon ? { icon: record.icon } : {}),
  sections: [...record.sections],
  permissions: [...record.permissions],
  languages: record.hasAccessToAllLanguages ? 'all' : [...record.languages],
})

/** The database's groups with how many users each has, when it exists. */
export async function databaseGroups(config: CromboloConfig) {
  return withExisting(config, async (db) => {
    const repo = new UserGroupRepository(db)
    const [groups, counts] = await Promise.all([repo.all(), repo.memberCounts()])
    return groups.map((group) => ({ group, users: counts.get(group.key.toLowerCase()) ?? 0 }))
  })
}

/** Moves every user in `from` to `to`, then removes `from` from the database. */
export async function moveUsersAndRemove(
  config: CromboloConfig,
  from: string,
  to: string | undefined,
): Promise<number> {
  return withDatabase(config, async (db) => {
    const groups = new UserGroupRepository(db)
    const source = await groups.byAlias(from)
    if (!source) return 0
    const users = (await new UserRepository(db).all()).filter((u) =>
      u.groupKeys.includes(source.key),
    )
    if (users.length > 0) {
      const target = to ? await groups.byAlias(to) : undefined
      if (!target)
        throw new CliError('not_found', `There is no group "${to}" to move its users to.`)
      const keys = users.map((u) => u.key)
      await new UserRepository(db).addToGroup(target.key, keys)
      await new UserRepository(db).removeFromGroup(source.key, keys)
    }
    await groups.delete(source.key)
    return users.length
  })
}

/** One of the site's own groups; one made in the back office is refused, saying how to make it the site's. */
export async function ownGroup(
  config: CromboloConfig,
  own: readonly SchemaUserGroup[],
  alias: string,
): Promise<SchemaUserGroup> {
  const wanted = alias.toLowerCase()
  const group = own.find((g) => g.alias.toLowerCase() === wanted)
  if (group) return group
  if (wanted === ADMIN_GROUP_ALIAS.toLowerCase())
    throw new CliError('refused', 'The administrators group is not changed here.')
  if (((await databaseGroups(config)) ?? []).some((d) => d.group.alias.toLowerCase() === wanted))
    throw new CliError(
      'refused',
      `"${alias}" was made in the back office, so it is not changed here.`,
      {
        hint: `\`crombolo users groups export ${alias}\` makes it one of the site's, and then the CLI changes it.`,
      },
    )
  throw new CliError('not_found', `There is no user group "${alias}".`, {
    hint: '`crombolo users groups list` lists them.',
  })
}
