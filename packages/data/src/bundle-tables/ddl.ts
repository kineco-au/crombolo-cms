/**
 * A step's operations as SQL, per dialect. Every identifier comes from the
 * resolved schema and is quoted here, every default is a literal the builder
 * already checked, and every statement passes the guard before it is returned.
 */
import type { ColumnDefinitionBuilder, Compilable } from 'kysely'
import type { Dialect } from '../dialect.ts'
import { compilerFor, sql } from '../query.ts'
import type { ColumnSpec, Operation } from './builder.ts'
import { guardStatement } from './guard.ts'
import type { ResolvedSchema } from './schema.ts'

/** The column type, from the dialect seam. Text compares case-sensitively on both. */
export function columnType(dialect: Dialect, spec: ColumnSpec): string {
  const t = dialect.types
  switch (spec.type) {
    case 'uuid':
      return t.uuid
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
  }
}

function literal(dialect: Dialect, value: string | number | boolean): string {
  if (typeof value === 'boolean')
    return dialect.name === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

/** A column's type and constraints, as the schema builder takes them. */
function defineColumn(dialect: Dialect, spec: ColumnSpec) {
  return (column: ColumnDefinitionBuilder): ColumnDefinitionBuilder => {
    let defined = column
    if (!spec.nullable) defined = defined.notNull()
    if (spec.default !== undefined)
      defined = defined.defaultTo(sql.raw(literal(dialect, spec.default)))
    return defined
  }
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
    const create = schema
      .createIndex(index.name)
      .on(table.physical)
      .columns([...index.columns])
    statements.push(index.unique ? create.unique() : create)
  }

  switch (op.op) {
    case 'createTable': {
      let create = schema.createTable(table.physical)
      for (const [name, spec] of Object.entries(op.columns))
        create = create.addColumn(name, type(spec), (column) => {
          const defined = defineColumn(dialect, spec)(column)
          return spec.primaryKey ? defined.primaryKey() : defined
        })
      statements.push(create)
      for (const [name, spec] of Object.entries(op.columns))
        if (spec.indexed && !spec.primaryKey) createIndex([name])
      break
    }
    case 'addColumn':
      statements.push(
        schema
          .alterTable(table.physical)
          .addColumn(op.column, type(op.spec), defineColumn(dialect, op.spec)),
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
            .alterTable(table.physical)
            .alterColumn(op.column, (column) => column.setDataType(type(op.spec))),
        )
      break
    case 'dropTable':
      statements.push(schema.dropTable(table.physical))
      break
    case 'dropColumn':
      statements.push(schema.alterTable(table.physical).dropColumn(op.column))
      break
    case 'dropIndex': {
      const index = before.tables.get(op.table)?.indexes.get(op.columns.join(','))
      if (!index) throw new Error(`no index on "${op.table}" (${op.columns.join(',')})`)
      statements.push(schema.dropIndex(index.name))
      break
    }
  }
  return statements.map((statement) =>
    guardStatement(before.id, before.prefix, statement.compile().sql),
  )
}

/** Every statement a step runs, in order. */
export function renderStep(
  dialect: Dialect,
  step: { before: ResolvedSchema; after: ResolvedSchema; operations: readonly Operation[] },
): string[] {
  return step.operations.flatMap((op) => renderOperation(dialect, step.before, step.after, op))
}
