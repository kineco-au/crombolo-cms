/**
 * Checking an owner's anonymise rules against its tables (story 189): the
 * site's from `database.anonymise`, a bundle's from its package.json. A rule
 * that names nothing, or that could not be written back, is refused up front
 * rather than found at export or import.
 */
import type { ColumnSpec, ResolvedSchema } from '@crombolo/data'
import { ANONYMISE_COLUMNS, type AnonymiseColumn } from '@crombolo/transfer'

const TEXT = new Set<ColumnSpec['type']>(['varchar', 'text'])
const MEMBER = new Set<ColumnSpec['type']>(['uuid', 'varchar', 'text'])

/** What a scrubbed column holds: null where it may, otherwise its type's empty value. */
export function emptyValue(spec: ColumnSpec): unknown {
  if (spec.nullable) return null
  switch (spec.type) {
    case 'varchar':
    case 'text':
      return ''
    case 'integer':
    case 'bigint':
      return 0
    case 'decimal':
      return '0'
    case 'boolean':
      return false
    case 'json':
      return {}
    default:
      return null
  }
}

function columnProblem(
  table: string,
  column: string,
  how: AnonymiseColumn,
  spec: ColumnSpec,
): string | undefined {
  const at = `${table}.${column}`
  if (how === 'email' && !TEXT.has(spec.type))
    return `${at} is "email", and holds ${spec.type} rather than text`
  if (how === 'member' && !MEMBER.has(spec.type))
    return `${at} is "member", and holds ${spec.type} rather than a member's key`
  if (how === 'member' && !spec.nullable)
    return `${at} is "member", so it must be nullable: it is emptied when its member does not travel`
  if (how === 'scrub' && emptyValue(spec) === null && !spec.nullable)
    return `${at} is "scrub", and a ${spec.type} that is not nullable has no empty value`
  return undefined
}

/** Every reason the rules cannot be used with these tables. */
export function anonymiseProblems(rules: unknown, schema: ResolvedSchema): string[] {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules))
    return ['anonymise maps each table to "keep" or to its columns\' rules']
  const problems: string[] = []
  for (const [table, rule] of Object.entries(rules)) {
    const declared = schema.tables.get(table)
    if (!declared) {
      problems.push(`anonymise names the table "${table}", which is not declared`)
      continue
    }
    if (rule === 'keep') continue
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      problems.push(`anonymise.${table} is "keep" or a map of its columns' rules`)
      continue
    }
    for (const [column, how] of Object.entries(rule as Record<string, unknown>)) {
      const spec = declared.columns.get(column)?.spec
      if (!spec) {
        problems.push(`anonymise.${table} names the column "${column}", which is not declared`)
        continue
      }
      if (!ANONYMISE_COLUMNS.includes(how as AnonymiseColumn)) {
        problems.push(`anonymise.${table}.${column} is "member", "email" or "scrub"`)
        continue
      }
      const problem = columnProblem(table, column, how as AnonymiseColumn, spec)
      if (problem) problems.push(problem)
    }
  }
  return problems
}
