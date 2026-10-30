/**
 * An owner's declaration, compiled: its steps in order, each with the schema it
 * starts from and the one it leaves, its kind, and its checksum. And the rules
 * a declaration is held to, which core's own plan is held to as well — a
 * contract only in a major, and only removing what an earlier release added.
 * docs/data-model.md, "Custom tables".
 */
import type { Kysely } from 'kysely'
import type { DialectName } from '../dialect.ts'
import { mayShipContract } from '../migrations.ts'
import {
  type ColumnSpec,
  type Op,
  type Operation,
  type SchemaBuilder,
  type ShapeOf,
  schemaBuilder,
  type TablesShape,
} from './builder.ts'
import { indexName, logicalNameProblem, SITE_OWNER } from './names.ts'

/** One step of an owner's chain, written with the builder. */
export interface BundleStep {
  /** Unique within the owner; what the ledger records and a refusal names. */
  name: string
  /** The owner's own release that ships this step. */
  release: string
  up(s: SchemaBuilder): Op<unknown> | readonly Op<unknown>[]
  /**
   * Writes data once `up` has run, in the same transaction, over the tables as
   * they now are, through the owner's Kysely handle. Untyped, because a step's
   * shape is only known once the steps before it are.
   */
  backfill?(db: BackfillDatabase): Promise<void>
}

/**
 * A step of the site's in SQL, for what the builder cannot say (story 189): run
 * as written, statement by statement, under the site's role. Untyped, so the
 * shape after it is declared by hand. Bundles cannot have one.
 */
export interface SqlStep {
  name: string
  release: string
  /** `expand` unless it removes something. */
  kind?: StepKind
  sql:
    | readonly string[]
    | { readonly sqlite: readonly string[]; readonly postgres: readonly string[] }
}

export type SiteStep = BundleStep | SqlStep

// biome-ignore lint/suspicious/noExplicitAny: the shape at a step is not known to the step's own type
export type BackfillDatabase = Kysely<any>

/** An owner's declared tables: the site's, or a bundle's under its id. */
export interface CustomTables<
  S extends TablesShape = TablesShape,
  Step extends SiteStep = SiteStep,
> {
  /** `site`, or the bundle's id. */
  readonly id: string
  readonly steps: readonly Step[]
  /** Type-level only: the shape after every step. */
  readonly __shape?: S
}

/** A bundle's declared tables: what `ServerBundle.tables` holds. */
export type BundleTables<S extends TablesShape = TablesShape> = CustomTables<S, BundleStep>

/** The site's declared tables: what `database.tables` holds in the config. */
export type SiteTables<S extends TablesShape = TablesShape> = CustomTables<S>

/**
 * Declares a bundle's tables. Nothing is checked or run here: the declaration
 * is checked when the bundle is wired, so every problem is reported at once.
 */
export function defineBundleTables<const Steps extends readonly BundleStep[]>(
  id: string,
  steps: Steps,
): BundleTables<ShapeOf<Steps>> {
  return Object.freeze({ id, steps: Object.freeze([...steps]) })
}

/** Declares the site's own tables, checked when the site boots. */
export function defineSiteTables<const Steps extends readonly SiteStep[]>(
  steps: Steps,
): SiteTables<ShapeOf<Steps>> {
  return Object.freeze({ id: SITE_OWNER, steps: Object.freeze([...steps]) })
}

const isSqlStep = (step: SiteStep): step is SqlStep => 'sql' in step

export interface ResolvedColumn {
  name: string
  spec: ColumnSpec
  /** The release of the step that added it, for the contract rule. */
  addedIn: { step: string; release: string }
}

export interface ResolvedIndex {
  name: string
  columns: string[]
  unique: boolean
  descending?: string[]
  where?: { column: string; is: 'null' | 'not null' }
  addedIn: { step: string; release: string }
}

export interface ResolvedTable {
  name: string
  columns: Map<string, ResolvedColumn>
  /** By the columns they cover, joined with commas. */
  indexes: Map<string, ResolvedIndex>
  addedIn: { step: string; release: string }
}

/** An owner's tables at one point in its chain. */
export interface ResolvedSchema {
  id: string
  tables: Map<string, ResolvedTable>
}

export type StepKind = 'expand' | 'contract'

export interface CompiledStep {
  name: string
  release: string
  position: number
  from: string
  to: string
  kind: StepKind
  operations: Operation[]
  /** A SQL step's statements, per dialect. */
  sql?: { sqlite: readonly string[]; postgres: readonly string[] }
  /** A hash of the operations, so a step edited after it shipped is caught. */
  checksum: string
  /** For a contract: the step that added the first thing it removes. */
  contracts: string | undefined
  before: ResolvedSchema
  after: ResolvedSchema
  backfill: BundleStep['backfill']
}

export interface CompiledTables {
  id: string
  stateKey: string
  initialState: string
  steps: CompiledStep[]
  /** The shape after every step: what the capability is resolved against. */
  schema: ResolvedSchema
  problems: string[]
}

/**
 * Where an owner's state is kept. 062's prefixed tables used
 * `Crombolo.Bundle.<id>.State`; a new key starts every chain again in the
 * owner's own schema or file.
 */
export const tablesStateKey = (id: string): string => `Crombolo.Tables.${id}.State`
export const tablesInitialState = (id: string): string => `tables:${id}:0`
const stateAt = (id: string, position: number, name: string): string =>
  `tables:${id}:${position}:${name}`

/** A SQL step's statements on one dialect. */
export function sqlStatements(
  step: { sql?: CompiledStep['sql'] },
  dialect: DialectName,
): readonly string[] {
  return step.sql?.[dialect] ?? []
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const STEP_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/
/** What a string default may hold: it is written into DDL as a literal. */
const SAFE_DEFAULT = /^[A-Za-z0-9 _.:@/-]{0,200}$/
const MAX_VARCHAR = 10_485_760
/** The most digits a decimal may declare, a common limit across engines. */
const MAX_PRECISION = 38

export function compareRelease(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number)
  const pb = b.split(/[.+-]/).map(Number)
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da < db ? -1 : 1
  }
  return 0
}

/** JSON with keys sorted, so the same operations always hash the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function clone(schema: ResolvedSchema): ResolvedSchema {
  const tables = new Map<string, ResolvedTable>()
  for (const [name, table] of schema.tables)
    tables.set(name, {
      ...table,
      columns: new Map(table.columns),
      indexes: new Map(table.indexes),
    })
  return { ...schema, tables }
}

function specProblem(spec: ColumnSpec, where: string): string | undefined {
  if (spec.type === 'varchar') {
    const length = spec.length ?? 0
    if (!Number.isInteger(length) || length < 1 || length > MAX_VARCHAR)
      return `${where} is a varchar of length ${spec.length}, which must be a whole number from 1`
  }
  if (spec.type === 'decimal') {
    const { precision = 0, scale = -1 } = spec
    if (!Number.isInteger(precision) || precision < 1 || precision > MAX_PRECISION)
      return `${where} is a decimal of precision ${spec.precision}, which must be a whole number from 1 to ${MAX_PRECISION}`
    if (!Number.isInteger(scale) || scale < 0 || scale > precision)
      return `${where} is a decimal of scale ${spec.scale}, which must be a whole number from 0 to its precision`
  }
  if (spec.primaryKey && spec.nullable) return `${where} is a primary key, so it cannot be nullable`
  if (spec.references?.onDelete === 'set null' && !spec.nullable)
    return `${where} is set to null when what it points at is deleted, so it must be nullable`
  if (spec.default === undefined) return undefined
  if (spec.type === 'json' || spec.type === 'timestamp')
    return `${where} is ${spec.type}, which cannot have a default`
  const expected =
    spec.type === 'boolean'
      ? 'boolean'
      : spec.type === 'integer' || spec.type === 'bigint' || spec.type === 'decimal'
        ? 'number'
        : 'string'
  if (typeof spec.default !== expected)
    return `${where} has the default ${JSON.stringify(spec.default)}, which is not a ${expected}`
  if (
    typeof spec.default === 'number' &&
    (spec.type === 'decimal' ? !Number.isFinite(spec.default) : !Number.isSafeInteger(spec.default))
  )
    return `${where} has the default ${spec.default}, which is not a ${spec.type === 'decimal' ? 'finite number' : 'whole number'}`
  if (typeof spec.default === 'string' && !SAFE_DEFAULT.test(spec.default))
    return `${where} has a default with characters a default may not hold: letters, digits, spaces and _ . : @ / - only`
  return undefined
}

const WIDER: Record<string, readonly string[]> = {
  varchar: ['varchar', 'text'],
  integer: ['bigint'],
}

/** The column types a foreign key may join: the same, or integers of either width. */
const keyFamily = (spec: ColumnSpec): string =>
  spec.type === 'integer' || spec.type === 'bigint'
    ? 'integer'
    : spec.type === 'varchar'
      ? 'text'
      : spec.type

/** Why a column's foreign key cannot be made, or undefined when it can. */
function referenceProblem(
  schema: ResolvedSchema,
  where: string,
  spec: ColumnSpec,
  self?: { name: string; columns: Map<string, ResolvedColumn> },
): string | undefined {
  const ref = spec.references
  if (!ref) return undefined
  const target =
    self && ref.table === self.name ? { columns: self.columns } : schema.tables.get(ref.table)
  if (!target) return `${where} points at "${ref.table}", which is not one of this owner's tables`
  const key =
    ref.column === undefined
      ? [...target.columns.values()].find((column) => column.spec.primaryKey)
      : target.columns.get(ref.column)
  if (!key) return `${where} points at "${ref.table}.${ref.column}", which does not exist`
  if (!key.spec.primaryKey && !key.spec.unique)
    return `${where} points at "${ref.table}.${key.name}", which is neither a primary key nor unique`
  if (keyFamily(key.spec) !== keyFamily(spec))
    return `${where} is ${spec.type} and points at "${ref.table}.${key.name}", which is ${key.spec.type}`
  if (!['cascade', 'restrict', 'set null'].includes(ref.onDelete))
    return `${where} has the delete rule "${ref.onDelete}", which is not cascade, restrict or set null`
  return undefined
}

function columnIndexes(
  table: string,
  column: string,
  spec: ColumnSpec,
  at: { step: string; release: string },
): ResolvedIndex | undefined {
  if (spec.primaryKey || !(spec.indexed || spec.unique)) return undefined
  return {
    name: indexName(table, [column]),
    columns: [column],
    unique: spec.unique === true,
    addedIn: at,
  }
}

/** Applies one operation, or says why it cannot be applied. */
function apply(
  schema: ResolvedSchema,
  op: Operation,
  step: { name: string; release: string },
): string | undefined {
  const at = { step: step.name, release: step.release }
  const table = schema.tables.get(op.table)
  const label = `step "${step.name}"`
  switch (op.op) {
    case 'createTable': {
      const nameProblem = logicalNameProblem('table', op.table)
      if (nameProblem) return `${label}: ${nameProblem}`
      if (table) return `${label} creates "${op.table}", which already exists`
      const columns = new Map<string, ResolvedColumn>()
      const entries = Object.entries(op.columns)
      if (entries.length === 0) return `${label} creates "${op.table}" with no columns`
      for (const [name, spec] of entries) {
        const problem =
          logicalNameProblem('column', name) ?? specProblem(spec, `"${op.table}.${name}"`)
        if (problem) return `${label}: ${problem}`
        columns.set(name, { name, spec, addedIn: at })
      }
      const keys = [...columns.values()].filter((column) => column.spec.primaryKey)
      if (keys.length !== 1)
        return `${label} creates "${op.table}" with ${keys.length} primary keys, not one`
      for (const column of columns.values()) {
        const problem = referenceProblem(schema, `"${op.table}.${column.name}"`, column.spec, {
          name: op.table,
          columns,
        })
        if (problem) return `${label}: ${problem}`
      }
      const created: ResolvedTable = { name: op.table, columns, indexes: new Map(), addedIn: at }
      for (const column of columns.values()) {
        const index = columnIndexes(op.table, column.name, column.spec, at)
        if (index) created.indexes.set(column.name, index)
      }
      schema.tables.set(op.table, created)
      return undefined
    }
    case 'addColumn': {
      if (!table) return `${label} adds a column to "${op.table}", which does not exist`
      const problem =
        logicalNameProblem('column', op.column) ??
        specProblem(op.spec, `"${op.table}.${op.column}"`) ??
        referenceProblem(schema, `"${op.table}.${op.column}"`, op.spec)
      if (problem) return `${label}: ${problem}`
      if (table.columns.has(op.column))
        return `${label} adds "${op.table}.${op.column}", which exists`
      if (op.spec.primaryKey)
        return `${label} adds a primary key to "${op.table}", which a table has already`
      if (!op.spec.nullable && op.spec.default === undefined)
        return `${label} adds "${op.table}.${op.column}" neither nullable nor with a default, which the rows already there cannot satisfy`
      // SQLite adds a column with a foreign key only when it starts out null.
      if (op.spec.references && (!op.spec.nullable || op.spec.default !== undefined))
        return `${label} adds "${op.table}.${op.column}" with a foreign key, which an added column may have only when it is nullable without a default`
      if (op.spec.unique)
        return `${label} adds "${op.table}.${op.column}" as unique; add it, then a unique index in a step of its own`
      table.columns.set(op.column, { name: op.column, spec: op.spec, addedIn: at })
      const index = columnIndexes(op.table, op.column, op.spec, at)
      if (index) table.indexes.set(op.column, index)
      return undefined
    }
    case 'addIndex': {
      if (!table) return `${label} indexes "${op.table}", which does not exist`
      if (op.columns.length === 0) return `${label} adds an index on no columns`
      for (const column of op.columns)
        if (!table.columns.has(column))
          return `${label} indexes "${op.table}.${column}", which does not exist`
      for (const column of op.descending ?? [])
        if (!op.columns.includes(column))
          return `${label} sorts "${op.table}.${column}" descending, which the index does not cover`
      if (op.where) {
        if (!table.columns.has(op.where.column))
          return `${label} limits an index to rows by "${op.table}.${op.where.column}", which does not exist`
        if (op.where.is !== 'null' && op.where.is !== 'not null')
          return `${label} limits an index to rows where a column is "${op.where.is}", not "null" or "not null"`
      }
      const key = op.columns.join(',')
      if (table.indexes.has(key)) return `${label} indexes "${op.table}" (${key}) twice`
      table.indexes.set(key, {
        name: indexName(op.table, op.columns),
        columns: [...op.columns],
        unique: op.unique,
        ...(op.descending ? { descending: [...op.descending] } : {}),
        ...(op.where ? { where: { ...op.where } } : {}),
        addedIn: at,
      })
      return undefined
    }
    case 'widenColumn': {
      const column = table?.columns.get(op.column)
      if (!table || !column)
        return `${label} widens "${op.table}.${op.column}", which does not exist`
      const from = column.spec
      const to = op.spec
      const wider =
        (from.type === to.type &&
          from.type === 'varchar' &&
          (to.length ?? 0) > (from.length ?? 0)) ||
        (from.type === to.type &&
          from.type === 'decimal' &&
          (to.scale ?? 0) >= (from.scale ?? 0) &&
          (to.precision ?? 0) - (to.scale ?? 0) >= (from.precision ?? 0) - (from.scale ?? 0) &&
          (to.precision ?? 0) > (from.precision ?? 0)) ||
        (from.type !== to.type && (WIDER[from.type] ?? []).includes(to.type))
      const size = (spec: ColumnSpec) =>
        spec.length ? `(${spec.length})` : spec.precision ? `(${spec.precision},${spec.scale})` : ''
      if (!wider)
        return `${label} changes "${op.table}.${op.column}" from ${from.type}${size(from)} to ${to.type}${size(to)}, which is not wider`
      if (
        to.nullable !== from.nullable ||
        to.default !== from.default ||
        to.primaryKey !== from.primaryKey ||
        JSON.stringify(to.references) !== JSON.stringify(from.references)
      )
        return `${label} widens "${op.table}.${op.column}" and changes more than its type`
      const problem = specProblem(to, `"${op.table}.${op.column}"`)
      if (problem) return `${label}: ${problem}`
      table.columns.set(op.column, {
        ...column,
        spec: { ...to, indexed: from.indexed, unique: from.unique },
      })
      return undefined
    }
    case 'dropTable': {
      if (!table) return `${label} drops "${op.table}", which does not exist`
      for (const other of schema.tables.values())
        if (other.name !== op.table)
          for (const column of other.columns.values())
            if (column.spec.references?.table === op.table)
              return `${label} drops "${op.table}" while "${other.name}.${column.name}" points at it; drop that first`
      schema.tables.delete(op.table)
      return undefined
    }
    case 'dropColumn': {
      const column = table?.columns.get(op.column)
      if (!table || !column)
        return `${label} drops "${op.table}.${op.column}", which does not exist`
      if (column.spec.primaryKey)
        return `${label} drops "${op.table}.${op.column}", the primary key`
      if (column.spec.references)
        return `${label} drops "${op.table}.${op.column}", which is a foreign key; SQLite cannot drop one`
      for (const index of table.indexes.values())
        if (index.columns.includes(op.column) || index.where?.column === op.column)
          return `${label} drops "${op.table}.${op.column}" while an index covers it; drop the index first`
      for (const other of schema.tables.values())
        for (const pointing of other.columns.values()) {
          const ref = pointing.spec.references
          if (ref?.table === op.table && ref.column === op.column)
            return `${label} drops "${op.table}.${op.column}" while "${other.name}.${pointing.name}" points at it`
        }
      table.columns.delete(op.column)
      return undefined
    }
    case 'dropIndex': {
      const key = op.columns.join(',')
      if (!table?.indexes.has(key))
        return `${label} drops an index on "${op.table}" (${key}), which does not exist`
      table.indexes.delete(key)
      return undefined
    }
  }
}

/** What a drop removes, for the contract rule: when it was added. */
function removedAddedIn(
  schema: ResolvedSchema,
  op: Operation,
): { step: string; release: string } | undefined {
  const table = schema.tables.get(op.table)
  if (op.op === 'dropTable') return table?.addedIn
  if (op.op === 'dropColumn') return table?.columns.get(op.column)?.addedIn
  if (op.op === 'dropIndex') return table?.indexes.get(op.columns.join(','))?.addedIn
  return undefined
}

const DROPS = new Set(['dropTable', 'dropColumn', 'dropIndex'])

const hash = (value: string): string => new Bun.CryptoHasher('sha256').update(value).digest('hex')

/**
 * Compiles a declaration, collecting every problem rather than stopping at the
 * first. `version` is the owner's own: no step may claim a release after it.
 */
export function compileTables(tables: CustomTables, version?: string): CompiledTables {
  const id = tables.id
  const problems: string[] = []
  let schema: ResolvedSchema = { id, tables: new Map() }
  const steps: CompiledStep[] = []
  const names = new Set<string>()
  let from = tablesInitialState(id)
  let previous: string | undefined

  for (const [index, step] of tables.steps.entries()) {
    const label = `step "${step.name}"`
    if (typeof step.name !== 'string' || !STEP_NAME.test(step.name))
      problems.push(
        `${label}: a step name is lowercase letters, digits, dots, hyphens and underscores`,
      )
    else if (names.has(step.name)) problems.push(`two steps are named "${step.name}"`)
    names.add(step.name)
    if (typeof step.release !== 'string' || !SEMVER.test(step.release)) {
      problems.push(`${label} declares the release "${step.release}", which is not a version`)
      continue
    }
    if (previous && compareRelease(step.release, previous) < 0)
      problems.push(`${label} ships in ${step.release}, before the step ahead of it (${previous})`)
    if (version && compareRelease(step.release, version) > 0)
      problems.push(
        `${label} ships in ${step.release}, which is later than this release (${version})`,
      )
    previous = step.release
    const to = stateAt(id, index + 1, step.name)

    if (isSqlStep(step)) {
      if (id !== SITE_OWNER) {
        problems.push(`${label} is SQL, which only the site's own tables may use`)
        continue
      }
      const sql = Array.isArray(step.sql)
        ? { sqlite: step.sql as readonly string[], postgres: step.sql as readonly string[] }
        : (step.sql as { sqlite: readonly string[]; postgres: readonly string[] })
      const empty = !Array.isArray(sql.sqlite) || !Array.isArray(sql.postgres)
      if (empty || sql.sqlite.length === 0 || sql.postgres.length === 0) {
        problems.push(`${label} has no SQL for both engines`)
        continue
      }
      if ([...sql.sqlite, ...sql.postgres].some((statement) => typeof statement !== 'string'))
        problems.push(`${label} has a statement that is not a string`)
      const kind: StepKind = step.kind ?? 'expand'
      if (kind !== 'expand' && kind !== 'contract')
        problems.push(`${label} is of the kind "${kind}", not expand or contract`)
      if (kind === 'contract' && !mayShipContract(step.release))
        problems.push(
          `${label} removes something in ${step.release}, but from 1.0 a contract may only ship in a major release (x.0.0)`,
        )
      // The builder does not follow what SQL does, so the tables a SQL step
      // makes are changed by SQL steps.
      const before = clone(schema)
      steps.push({
        name: step.name,
        release: step.release,
        position: index + 1,
        from,
        to,
        kind,
        operations: [],
        sql: { sqlite: [...sql.sqlite], postgres: [...sql.postgres] },
        checksum: hash(canonical(sql)),
        contracts: undefined,
        before,
        after: clone(schema),
        backfill: undefined,
      })
      from = to
      continue
    }

    let operations: Operation[]
    try {
      const returned = step.up(schemaBuilder)
      operations = (Array.isArray(returned) ? returned : [returned]) as Operation[]
    } catch (error) {
      problems.push(
        `${label} failed to describe itself: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    if (operations.length === 0) {
      problems.push(`${label} does nothing`)
      continue
    }

    const drops = operations.filter((op) => DROPS.has(op.op))
    const kind: StepKind = drops.length > 0 ? 'contract' : 'expand'
    if (kind === 'contract' && drops.length !== operations.length)
      problems.push(`${label} both adds and removes; a step is an expand or a contract, never both`)

    const before = clone(schema)
    const working = clone(schema)
    let contracts: string | undefined
    for (const op of operations) {
      if (DROPS.has(op.op)) {
        const added = removedAddedIn(working, op)
        if (added) {
          contracts ??= added.step
          if (compareRelease(added.release, step.release) >= 0)
            problems.push(
              `${label} (${step.release}) removes what "${added.step}" added in ${added.release}; a contract may only remove what an earlier release added`,
            )
        }
      }
      const problem = apply(working, op, step)
      if (problem) problems.push(problem)
    }
    if (kind === 'contract' && !mayShipContract(step.release))
      problems.push(
        `${label} removes something in ${step.release}, but from 1.0 a contract may only ship in a major release (x.0.0)`,
      )
    schema = working

    steps.push({
      name: step.name,
      release: step.release,
      position: index + 1,
      from,
      to,
      kind,
      operations,
      // Bare hex: the ledger's checksum column holds 64 characters.
      checksum: hash(canonical(operations)),
      contracts,
      before,
      after: clone(schema),
      backfill: step.backfill,
    })
    from = to
  }

  return {
    id,
    stateKey: tablesStateKey(id),
    initialState: tablesInitialState(id),
    steps,
    schema,
    problems,
  }
}

/**
 * Throws when a declaration breaks a rule, naming every problem. For a bundle's
 * own test suite, so it is held to the same rules before it ships as it is when
 * a site wires it.
 */
export function assertBundleTables(tables: CustomTables, version: string): void {
  const { problems } = compileTables(tables, version)
  if (problems.length > 0)
    throw new Error(`The tables of "${tables.id}" break the rules:\n- ${problems.join('\n- ')}`)
}

/** `breaking` exactly when this release of the bundle ships a contract: what its package.json declares. */
export function bundleTablesCompatibility(
  tables: CustomTables,
  version: string,
): 'compatible' | 'breaking' {
  return compileTables(tables).steps.some(
    (step) => step.kind === 'contract' && compareRelease(step.release, version) === 0,
  )
    ? 'breaking'
    : 'compatible'
}
