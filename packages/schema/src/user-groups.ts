/**
 * `schema/user-groups/*.toml` — user groups a site declares (story 228): what a
 * group is (its name, sections, permission verbs and languages), never where it
 * starts or who is in it, which each environment's Users section keeps. Strict
 * as the type parser is, and canonical on the way out, so
 * `parseUserGroup(writeUserGroup(x))` equals `x`. `docs/schema-as-code.md`.
 */
import {
  ADMIN_GROUP_ALIAS,
  isExtensionSectionAlias,
  KNOWN_PERMISSIONS,
  SECTION_ALIASES,
} from '@crombolo/core'
import { type ParseResult, Reader, toml } from './reader.ts'

export interface SchemaUserGroup {
  alias: string
  name: string
  description?: string
  icon?: string
  /** Application aliases (`content`), or an extension section's manifest alias. */
  sections: string[]
  permissions: string[]
  /** ISO codes, or every language. */
  languages: string[] | 'all'
}

const KEYS = ['alias', 'name', 'description', 'icon', 'sections', 'permissions', 'languages']

export function parseUserGroup(file: string, source: string): ParseResult<SchemaUserGroup> {
  const r = new Reader(file)
  const root = toml(source, r)
  if (!root) return { value: undefined, problems: r.problems }
  r.unknown(root, ['user-group'], '')
  const t = r.table(root['user-group'], 'user-group')
  if (!t) {
    r.problem('user-group', 'a [user-group] table is required')
    return { value: undefined, problems: r.problems }
  }
  const path = 'user-group'
  r.unknown(t, KEYS, path)
  const alias = r.str(t, 'alias', path, true) ?? ''
  if (alias.toLowerCase() === ADMIN_GROUP_ALIAS)
    r.problem(
      `${path}.alias`,
      'the administrators group is built in, and a file cannot redefine it',
    )
  const sections = r.strs(t, 'sections', path)
  for (const section of sections)
    if (!(section in SECTION_ALIASES) && !isExtensionSectionAlias(section))
      r.problem(
        `${path}.sections`,
        `"${section}" is not a section: one of ${Object.keys(SECTION_ALIASES).join(', ')}, or an extension's section alias`,
      )
  const permissions = r.strs(t, 'permissions', path)
  for (const permission of permissions)
    if (!KNOWN_PERMISSIONS.has(permission))
      r.problem(`${path}.permissions`, `"${permission}" is not a permission verb`)
  let languages: string[] | 'all' = []
  if (t.languages === 'all') languages = 'all'
  else if (t.languages !== undefined) languages = r.strs(t, 'languages', path)
  const description = r.str(t, 'description', path)
  const icon = r.str(t, 'icon', path)
  const value: SchemaUserGroup = {
    alias,
    name: r.str(t, 'name', path, true) ?? '',
    ...(description !== undefined ? { description } : {}),
    ...(icon !== undefined ? { icon } : {}),
    sections,
    permissions,
    languages,
  }
  return { value: r.problems.length === 0 ? value : undefined, problems: r.problems }
}

const str = (value: string) => JSON.stringify(value)
const list = (values: readonly string[]) => `[${values.map(str).join(', ')}]`

export function writeUserGroup(group: SchemaUserGroup): string {
  const out = ['[user-group]', `alias = ${str(group.alias)}`, `name = ${str(group.name)}`]
  if (group.description !== undefined) out.push(`description = ${str(group.description)}`)
  if (group.icon !== undefined) out.push(`icon = ${str(group.icon)}`)
  out.push(
    `sections = ${list(group.sections)}`,
    `permissions = ${list(group.permissions)}`,
    `languages = ${group.languages === 'all' ? '"all"' : list(group.languages)}`,
  )
  return `${out.join('\n')}\n`
}
