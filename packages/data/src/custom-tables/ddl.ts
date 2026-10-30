/**
 * A step's operations as SQL, per dialect, unqualified: they run in the
 * owner's own schema or file. Every identifier comes from the resolved schema
 * and is quoted here, and every default is a literal the builder already
 * checked.
 */
import type { ColumnDefinitionBuilder, Compilable } from 'kysely'
import type { Dialect } from '../dialect.ts'
import { compilerFor, sql } from '../query.ts'
import type { ColumnSpec, Operation } from './builder.ts'
import { type CompiledStep, type ResolvedSchema, sqlStatements } from './schema.ts'

/**
 * The column type, from the dialect seam. Text compares case-sensitively on
 * both; a uuid compares without case on both, as Postgres's own type does.
 */
export function columnType(dialect: Dialect, spec: ColumnSpec): string {
  const t = dialect.types
  switch (spec.type) {
    case 'uuid':
      return dialect.name === 'sqlite' ? 'TEXT COLLATE NOCASE' : t.uuid
    case 'varchar':
      return t.varcharExact(spec.length ?? 1)
    case 'text':
      return t.text
    case 'integer':
      return t.integer
    case 'bigint':
      return t.bigint
    case 'boolean':
      return t.boolean
    case 'timestamp':
      return t.timestamp
    case 'json':
      return t.json
    case 'decimal':
      // NUMERIC affinity on SQLite, so a sum and an order are by value, not text.
      return `NUMERIC(${spec.precision ?? 1}, ${spec.scale ?? 0})`
  }
}

function literal(dialect: Dialect, value: string | number | boolean): string {
  if (typeof value === 'boolean')
    return dialect.name === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

/** A column's type and constraints, as the schema builder takes them. */
function defineColumn(dialect: Dialect, spec: ColumnSpec, schema: ResolvedSchema, self?: string) {
  return (column: ColumnDefinitionBuilder): ColumnDefinitionBuilder => {
    let defined = column
    if (!spec.nullable) defined = defined.notNull()
    if (spec.default !== undefined)
      defined = defined.defaultTo(sql.raw(literal(dialect, spec.default)))
    const ref = spec.references
    if (ref) {
      const target = ref.column ?? primaryKeyOf(schema, ref.table, self)
      defined = defined.references(`${ref.table}.${target}`).onDelete(ref.onDelete)
    }
    return defined
  }
}

function primaryKeyOf(schema: ResolvedSchema, table: string, self?: string): string {
  const found = schema.tables.get(table)
  const key = found && [...found.columns.values()].find((column) => column.spec.primaryKey)
  if (!key) throw new Error(`no primary key on "${table}"${self ? ` for "${self}"` : ''}`)
  return key.name
}

/** The statements one operation runs, against the schema as it stood before it. */
export function renderOperation(
  dialect: Dialect,
  before: ResolvedSchema,
  after: ResolvedSchema,
  op: Operation,
): string[] {
  const schema = compilerFor(dialect).schema
  const type = (spec: ColumnSpec) => sql.raw(columnType(dialect, spec))
  const table = after.tables.get(op.table) ?? before.tables.get(op.table)
  if (!table) throw new Error(`no table "${op.table}" to render ${op.op} against`)
  const statements: Compilable[] = []
  const indexFor = (columns: readonly string[]) => {
    const index = (after.tables.get(op.table) ?? table).indexes.get(columns.join(','))
    if (!index) throw new Error(`no index on "${op.table}" (${columns.join(',')})`)
    return index
  }
  const createIndex = (columns: readonly string[]) => {
    const index = indexFor(columns)
    const descending = new Set(index.descending ?? [])
    let create = schema
      .createIndex(index.name)
      .on(table.name)
      .columns(index.columns.map((column) => (descending.has(column) ? `${column} desc` : column)))
    if (index.unique) create = create.unique()
    if (index.where)
      create = create.where(index.where.column, index.where.is === 'null' ? 'is' : 'is not', null)
    statements.push(create)
  }

  switch (op.op) {
    case 'createTable': {
      let create = schema.createTable(table.name)
      for (const [name, spec] of Object.entries(op.columns))
        create = create.addColumn(name, type(spec), (column) => {
          const defined = defineColumn(dialect, spec, after, table.name)(column)
          return spec.primaryKey ? defined.primaryKey() : defined
        })
      statements.push(create)
      for (const [name, spec] of Object.entries(op.columns))
        if ((spec.indexed || spec.unique) && !spec.primaryKey) createIndex([name])
      break
    }
    case 'addColumn':
      statements.push(
        schema
          .alterTable(table.name)
          .addColumn(op.column, type(op.spec), defineColumn(dialect, op.spec, after)),
      )
      if (op.spec.indexed) createIndex([op.column])
      break
    case 'addIndex':
      createIndex(op.columns)
      break
    case 'widenColumn':
      // SQLite stores by affinity and enforces no length, so a wider type is
      // already what it holds; only Postgres has anything to change.
      if (dialect.name === 'postgres')
        statements.push(
          schema
            .alterTable(table.name)
            .alterColumn(op.column, (column) => column.setDataType(type(op.spec))),
        )
      break
    case 'dropTable':
      statements.push(schema.dropTable(table.name))
      break
    case 'dropColumn':
      statements.push(schema.alterTable(table.name).dropColumn(op.column))
      break
    case 'dropIndex': {
      const index = before.tables.get(op.table)?.indexes.get(op.columns.join(','))
      if (!index) throw new Error(`no index on "${op.table}" (${op.columns.join(',')})`)
      statements.push(schema.dropIndex(index.name))
      break
    }
  }
  return statements.map((statement) => statement.compile().sql)
}

/** Every statement a step runs, in order: a SQL step's as written. */
export function renderStep(
  dialect: Dialect,
  step: Pick<CompiledStep, 'before' | 'after' | 'operations' | 'sql'>,
): string[] {
  if (step.sql) return [...sqlStatements(step, dialect.name)]
  return step.operations.flatMap((op) => renderOperation(dialect, step.before, step.after, op))
}
