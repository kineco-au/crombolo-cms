/**
 * Values in custom tables read and write the same on both engines (story 189).
 * The drivers disagree: SQLite hands back a boolean as 0 or 1, a timestamp as
 * text and a decimal as a number, and Bun's SQLite driver writes a `Date` as
 * null. So a write's values are made portable as they are bound, and a read's
 * columns are converted by the declared type of the column each one selects.
 *
 * Only a column the query names, or `*`, is converted: an expression arrives as
 * the engine computes it.
 */
import type {
  KyselyPlugin,
  OperationNode,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryResult,
  RootOperationNode,
  UnknownRow,
} from 'kysely'
import { DbDate, type Dialect, fromDbBool } from '../dialect.ts'
import type { ColumnSpec } from './builder.ts'
import type { ResolvedSchema } from './schema.ts'

/** A value as either engine binds it: dates as ISO text, booleans as the dialect writes them, JSON as text. */
export function portableParam(dialect: Dialect, value: unknown): unknown {
  if (value instanceof Date) return DbDate.toDb(value)
  if (typeof value === 'boolean') return dialect.boolValue(value)
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value
  if (Array.isArray(value) || (value !== null && typeof value === 'object'))
    return JSON.stringify(value)
  return value
}

/** A stored value as its declared type reads it. */
export function readValue(spec: ColumnSpec, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (spec.type) {
    case 'uuid':
      return String(value).toLowerCase()
    case 'varchar':
    case 'text':
      return String(value)
    case 'integer':
    case 'bigint':
      return Number(value)
    case 'boolean':
      return fromDbBool(value)
    case 'timestamp':
      return DbDate.fromDb(value) ?? null
    case 'json':
      return typeof value === 'string' ? JSON.parse(value) : value
    case 'decimal':
      return typeof value === 'number' ? value.toFixed(spec.scale ?? 0) : String(value)
  }
}

type Node = OperationNode & Record<string, unknown>

const identifier = (node: unknown): string | undefined =>
  (node as { name?: string } | undefined)?.name

/** A table node's name: `TableNode { table: { identifier } }`. */
function tableName(node: unknown): string | undefined {
  const table = node as Node | undefined
  if (table?.kind !== 'TableNode') return undefined
  return identifier((table.table as Node | undefined)?.identifier)
}

/** The tables a query reads from, by the name or alias each is referred to by. */
function scopeOf(node: Node): Map<string, string> {
  const scope = new Map<string, string>()
  const add = (item: unknown) => {
    const n = item as Node | undefined
    if (!n) return
    if (n.kind === 'AliasNode') {
      const table = tableName(n.node)
      const alias = identifier(n.alias)
      if (table && alias) scope.set(alias, table)
      return
    }
    const table = tableName(n)
    if (table) scope.set(table, table)
  }
  for (const from of ((node.from as Node | undefined)?.froms as unknown[]) ?? []) add(from)
  for (const join of (node.joins as Node[] | undefined) ?? []) add(join.table)
  add(node.into)
  add(node.table)
  return scope
}

/**
 * Each output column of a query that is a column of one of the owner's
 * tables, with its declaration; undefined when there is nothing to convert.
 */
export function outputsOf(
  node: RootOperationNode,
  schema: ResolvedSchema,
): Map<string, ColumnSpec> | undefined {
  const root = node as unknown as Node
  const selections =
    root.kind === 'SelectQueryNode'
      ? (root.selections as Node[] | undefined)
      : ((root.returning as Node | undefined)?.selections as Node[] | undefined)
  if (!selections?.length) return undefined
  const scope = scopeOf(root)
  const outputs = new Map<string, ColumnSpec>()
  const columnsOf = (table: string | undefined) => schema.tables.get(table ?? '')?.columns
  const all = (table?: string) => {
    const tables = table ? [table] : [...scope.values()]
    for (const name of tables)
      for (const [column, resolved] of columnsOf(name) ?? []) outputs.set(column, resolved.spec)
  }
  /** The declaration of a referenced column, looking it up in the one table that has it. */
  const specOf = (reference: Node): { column: string; spec?: ColumnSpec } | undefined => {
    const column = reference.column as Node
    const qualifier = tableName(reference.table)
    if (column?.kind === 'SelectAllNode') {
      all(qualifier ? (scope.get(qualifier) ?? qualifier) : undefined)
      return undefined
    }
    const name = identifier((column as Node | undefined)?.column)
    if (!name) return undefined
    if (qualifier) return { column: name, spec: columnsOf(scope.get(qualifier))?.get(name)?.spec }
    const owners = [...new Set(scope.values())].filter((table) => columnsOf(table)?.has(name))
    return {
      column: name,
      spec: owners.length === 1 ? columnsOf(owners[0])?.get(name)?.spec : undefined,
    }
  }
  for (const selection of selections) {
    const item = (selection.selection ?? selection) as Node
    if (item.kind === 'SelectAllNode') all()
    else if (item.kind === 'ReferenceNode') {
      const found = specOf(item)
      if (found?.spec) outputs.set(found.column, found.spec)
    } else if (item.kind === 'ColumnNode') {
      const name = identifier(item.column)
      const owners = [...new Set(scope.values())].filter((table) =>
        columnsOf(table)?.has(name ?? ''),
      )
      const spec = owners.length === 1 ? columnsOf(owners[0])?.get(name ?? '')?.spec : undefined
      if (name && spec) outputs.set(name, spec)
    } else if (item.kind === 'AliasNode') {
      const inner = item.node as Node
      const alias = identifier(item.alias)
      if (alias && inner?.kind === 'ReferenceNode') {
        const found = specOf(inner)
        if (found?.spec) outputs.set(alias, found.spec)
      }
    }
  }
  return outputs.size > 0 ? outputs : undefined
}

/** The plugin that converts what a query reads by what its columns are declared as. */
export class PortableValues implements KyselyPlugin {
  readonly #schema: ResolvedSchema
  readonly #outputs = new WeakMap<object, Map<string, ColumnSpec>>()

  constructor(schema: ResolvedSchema) {
    this.#schema = schema
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const outputs = outputsOf(args.node, this.#schema)
    if (outputs) this.#outputs.set(args.queryId, outputs)
    return args.node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const outputs = this.#outputs.get(args.queryId)
    if (!outputs) return args.result
    const rows = args.result.rows.map((row) => {
      const out: UnknownRow = { ...row }
      for (const [column, spec] of outputs)
        if (Object.hasOwn(out, column)) out[column] = readValue(spec, out[column])
      return out
    })
    return { ...args.result, rows }
  }
}
