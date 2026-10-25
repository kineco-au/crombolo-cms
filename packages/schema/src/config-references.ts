/**
 * Which data-type config fields name types, and how (story 161). A file names a
 * type by alias wherever an editor's config takes a key; sync resolves the
 * alias to the key in the shape the editor reads (a comma-separated string
 * where it expects one), and export writes keys back as aliases. A value shaped
 * like a uuid is a key already and passes through either way.
 */
import type { SchemaTypeKind } from './model.ts'

/** What a reference must name: an element type, or a type of one kind. */
export type ReferenceKind = 'element' | SchemaTypeKind

interface FieldReference {
  /** The path into the config; `*` steps into every item of an array. */
  path: readonly string[]
  /** One alias, or a list (written as a comma-separated string). */
  many: boolean
  /** What it names; `startNode` reads the kind from the picker's start node type. */
  kind: ReferenceKind | 'startNode'
}

const BLOCK_FIELDS: readonly FieldReference[] = [
  { path: ['blocks', '*', 'contentElementTypeKey'], many: false, kind: 'element' },
  { path: ['blocks', '*', 'settingsElementTypeKey'], many: false, kind: 'element' },
]

export const CONFIG_REFERENCES: Readonly<Record<string, readonly FieldReference[]>> = {
  'Umbraco.ElementPicker': [{ path: ['allowedContentTypes'], many: true, kind: 'element' }],
  'Umbraco.MediaPicker3': [{ path: ['filter'], many: true, kind: 'media' }],
  'Umbraco.MultiNodeTreePicker': [{ path: ['filter'], many: true, kind: 'startNode' }],
  'Umbraco.BlockList': BLOCK_FIELDS,
  'Umbraco.RichText': BLOCK_FIELDS,
  'Umbraco.BlockGrid': [
    ...BLOCK_FIELDS,
    {
      path: ['blocks', '*', 'areas', '*', 'specifiedAllowance', '*', 'elementTypeKey'],
      many: false,
      kind: 'element',
    },
  ],
}

const UUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i
export const looksLikeKey = (value: string): boolean => UUID.test(value.trim())

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The kind a tree picker's `filter` names, from its start node's type. */
function startNodeKind(config: Record<string, unknown>): ReferenceKind {
  const type = isRecord(config.startNode) ? String(config.startNode.type ?? '') : ''
  return type === 'media' ? 'media' : type === 'member' ? 'member' : 'document'
}

/** One unresolvable reference, for `types check` to name. */
export interface ConfigReferenceProblem {
  path: string
  alias: string
  kind: ReferenceKind
}

/** The items of a many-valued field, from a list or a comma-separated string. */
const itemsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : []

/**
 * Walks every reference field in a config and replaces each value with what
 * `map` makes of it, returning a copy. `map` answers undefined to leave a
 * value as it is.
 */
function mapReferences(
  editor: string,
  config: Record<string, unknown>,
  map: (value: string, kind: ReferenceKind, path: string) => string | undefined,
  write: (items: string[]) => unknown,
): Record<string, unknown> {
  const fields = CONFIG_REFERENCES[editor]
  if (!fields) return config
  const copy = structuredClone(config)
  for (const field of fields) {
    const kind = field.kind === 'startNode' ? startNodeKind(config) : field.kind
    const visit = (node: unknown, rest: readonly string[], at: string): unknown => {
      if (rest.length === 0) {
        if (field.many) {
          const items = itemsOf(node)
          if (items.length === 0) return node
          const mapped = items.map((item) => map(item, kind, at))
          // Nothing to change: left exactly as written, list or string.
          if (mapped.every((value) => value === undefined)) return node
          return write(items.map((item, index) => mapped[index] ?? item))
        }
        return typeof node === 'string' ? (map(node, kind, at) ?? node) : node
      }
      const [step, ...tail] = rest as [string, ...string[]]
      if (step === '*') {
        if (!Array.isArray(node)) return node
        return node.map((item, index) => visit(item, tail, `${at}[${index}]`))
      }
      if (!isRecord(node) || !(step in node)) return node
      node[step] = visit(node[step], tail, at ? `${at}.${step}` : step)
      return node
    }
    visit(copy, field.path, '')
  }
  return copy
}

/**
 * Aliases to keys, in the editor's own shape (story 161). `lookup` answers the
 * key of a type of that kind; what it cannot answer is reported, and left as
 * written.
 */
export function resolveConfig(
  editor: string,
  config: Record<string, unknown>,
  lookup: (alias: string, kind: ReferenceKind) => string | undefined,
): { config: Record<string, unknown>; problems: ConfigReferenceProblem[] } {
  const problems: ConfigReferenceProblem[] = []
  const resolved = mapReferences(
    editor,
    config,
    (value, kind, path) => {
      if (looksLikeKey(value)) return undefined
      const key = lookup(value, kind)
      if (!key) problems.push({ path, alias: value, kind })
      return key
    },
    (items) => items.join(','),
  )
  return { config: resolved, problems }
}

/** Keys to aliases, as a file writes them: lists as lists. A key with no alias stays a key. */
export function aliasConfig(
  editor: string,
  config: Record<string, unknown>,
  reverse: (key: string) => string | undefined,
): Record<string, unknown> {
  return mapReferences(
    editor,
    config,
    (value) => (looksLikeKey(value) ? reverse(value) : undefined),
    (items) => items,
  )
}
