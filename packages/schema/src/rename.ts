/**
 * Renames that keep their content (story 250): a type's, a property's or a data
 * type's alias changed across a whole `SchemaSet`. The renamed definition keeps
 * its key, written into its file since the key would otherwise follow the new
 * alias, so the sync moves the alias and the values stay. Every other
 * definition naming the old alias is listed, and rewritten when asked.
 */
import {
  BUILTIN_DATA_TYPE_ALIASES,
  SYSTEM_CONTENT_TYPE_ALIASES,
  SYSTEM_MEDIA_TYPE_ALIASES,
} from './builtin.ts'
import { mapReferences, type ReferenceKind } from './config-references.ts'
import { dataTypeKeyFor, propertyKeyFor, shippedPropertyKeys, typeKeyFor } from './keys.ts'
import {
  allProperties,
  type SchemaContentType,
  type SchemaDataType,
  type SchemaSet,
  type SchemaTypeKind,
} from './model.ts'

/** One definition that names what is renamed, as a person reads it. */
export interface RenameReference {
  /** `content type "page"`, `data type "pageBlocks"`, `form "contact"`. */
  in: string
  /** What there names it: `allowed child`, `block`, `save as content`. */
  how: string
}

export type RenameResult =
  | { ok: true; set: SchemaSet; references: RenameReference[] }
  | { ok: false; reason: string }

const ALIAS = /^[A-Za-z][A-Za-z0-9_]*$/

const nouns: Record<SchemaTypeKind, string> = {
  document: 'content type',
  media: 'media type',
  member: 'member type',
}

const typesOfKind = (set: SchemaSet, kind: SchemaTypeKind) =>
  kind === 'media'
    ? (set.mediaTypes ?? [])
    : kind === 'member'
      ? (set.memberTypes ?? [])
      : set.contentTypes

const withTypes = (set: SchemaSet, kind: SchemaTypeKind, types: SchemaContentType[]): SchemaSet =>
  kind === 'media'
    ? { ...set, mediaTypes: types }
    : kind === 'member'
      ? { ...set, memberTypes: types }
      : { ...set, contentTypes: types }

const refuse = (reason: string): RenameResult => ({ ok: false, reason })

function newAliasProblem(to: string, taken: boolean, reserved: boolean): string | undefined {
  if (!ALIAS.test(to))
    return `"${to}" is not an alias: letters, digits and _, starting with a letter`
  if (reserved) return `"${to}" belongs to a type every site has`
  if (taken) return `"${to}" is taken`
  return undefined
}

type Property = SchemaContentType['properties'][number]

/** A type with each of its properties, wherever they sit, put through `map`. */
const mapProperties = (
  type: SchemaContentType,
  map: (p: Property) => Property,
): SchemaContentType => ({
  ...type,
  properties: type.properties.map(map),
  groups: type.groups?.map((g) => ({ ...g, properties: g.properties.map(map) })),
  tabs: type.tabs.map((t) => ({
    ...t,
    properties: t.properties.map(map),
    groups: t.groups.map((g) => ({ ...g, properties: g.properties.map(map) })),
  })),
})

/** Every type of every kind, each with its kind's noun. */
const allTypes = (set: SchemaSet) =>
  (['document', 'media', 'member'] as const).flatMap((kind) =>
    typesOfKind(set, kind).map((type) => ({ kind, type })),
  )

/** A type's alias renamed: the type keeps its key, and every definition naming it follows. */
export function renameType(
  set: SchemaSet,
  kind: SchemaTypeKind,
  from: string,
  to: string,
): RenameResult {
  const types = typesOfKind(set, kind)
  const type = types.find((t) => t.alias === from)
  if (!type) return refuse(`there is no ${nouns[kind]} "${from}"`)
  if (SYSTEM_CONTENT_TYPE_ALIASES.has(from) || SYSTEM_MEDIA_TYPE_ALIASES.has(from))
    return refuse(`"${from}" is a type every site has, and is not renamed`)
  const problem = newAliasProblem(
    to,
    types.some((t) => t.alias.toLowerCase() === to.toLowerCase() && t !== type),
    SYSTEM_CONTENT_TYPE_ALIASES.has(to) || SYSTEM_MEDIA_TYPE_ALIASES.has(to),
  )
  if (problem) return refuse(problem)
  const references: RenameReference[] = []
  const swap = (list: readonly string[]) => list.map((alias) => (alias === from ? to : alias))
  const elementOrKind: ReferenceKind[] = kind === 'document' ? ['element', 'document'] : [kind]

  // A built-in type's properties take shipped keys by its alias: the renamed one says them.
  const shipped = shippedPropertyKeys(kind, from)
  const keep = <P extends { alias: string; key?: string }>(p: P): P =>
    shipped.has(p.alias) ? { ...p, key: p.key ?? shipped.get(p.alias) } : p
  const renamedType: SchemaContentType = {
    ...mapProperties(type, keep),
    alias: to,
    key: type.key ?? typeKeyFor(kind, from),
  }
  let next = withTypes(
    set,
    kind,
    types.map((t) => (t === type ? renamedType : t)),
  )
  // Other types' allowed children and compositions.
  for (const k of ['document', 'media', 'member'] as const)
    next = withTypes(
      next,
      k,
      typesOfKind(next, k).map((t) => {
        if (k !== kind) return t
        const child = t.allowChildren.includes(from)
        const composed = t.compositions.includes(from)
        if (child) references.push({ in: `${nouns[k]} "${t.alias}"`, how: 'allowed child' })
        if (composed) references.push({ in: `${nouns[k]} "${t.alias}"`, how: 'composition' })
        return child || composed
          ? { ...t, allowChildren: swap(t.allowChildren), compositions: swap(t.compositions) }
          : t
      }),
    )
  // Data types: blocks, and the settings that name types (story 161).
  next = {
    ...next,
    dataTypes: next.dataTypes.map((d) => {
      let named = false
      const blocks = d.blocks?.map((b) => {
        if (b.element !== from && b.settings !== from) return b
        named = true
        references.push({ in: `data type "${d.alias}"`, how: 'block' })
        return {
          ...b,
          element: b.element === from ? to : b.element,
          settings: b.settings === from ? to : b.settings,
        }
      })
      const config = mapReferences(
        d.editor,
        d.config,
        (value, k) => {
          if (value !== from || !elementOrKind.includes(k)) return undefined
          named = true
          references.push({ in: `data type "${d.alias}"`, how: 'picker allows' })
          return to
        },
        (items) => items,
      )
      return named ? { ...d, config, ...(blocks ? { blocks } : {}) } : d
    }),
  }
  // Approval workflows and forms' save-as-content workflows.
  next = {
    ...next,
    workflows: next.workflows?.map((w) => {
      if (!w.appliesTo.contentTypes.includes(from)) return w
      references.push({ in: `approval workflow "${w.alias}"`, how: 'applies to' })
      return { ...w, appliesTo: { ...w.appliesTo, contentTypes: swap(w.appliesTo.contentTypes) } }
    }),
    forms: next.forms?.map((f) => {
      let named = false
      const workflows = f.workflows.map((w) => {
        if (w.type !== 'saveAsContent' || w.settings['content-type'] !== from) return w
        named = true
        references.push({ in: `form "${f.alias}"`, how: 'save as content' })
        return { ...w, settings: { ...w.settings, 'content-type': to } }
      })
      return named ? { ...f, workflows } : f
    }),
  }
  return { ok: true, set: next, references }
}

/** A property's alias renamed: it keeps its key, and every definition naming it follows. */
export function renameProperty(
  set: SchemaSet,
  kind: SchemaTypeKind,
  typeAlias: string,
  from: string,
  to: string,
): RenameResult {
  const types = typesOfKind(set, kind)
  const type = types.find((t) => t.alias === typeAlias)
  if (!type) return refuse(`there is no ${nouns[kind]} "${typeAlias}"`)
  if (SYSTEM_CONTENT_TYPE_ALIASES.has(typeAlias) || SYSTEM_MEDIA_TYPE_ALIASES.has(typeAlias))
    return refuse(`"${typeAlias}" is a type every site has, and its properties are not renamed`)
  const properties = allProperties(type)
  if (!properties.some((p) => p.alias === from))
    return refuse(`"${typeAlias}" has no property "${from}"`)
  const problem = newAliasProblem(
    to,
    properties.some((p) => p.alias.toLowerCase() === to.toLowerCase() && p.alias !== from),
    false,
  )
  if (problem) return refuse(problem)
  const typeKey = type.key ?? typeKeyFor(kind, typeAlias)
  const shipped = shippedPropertyKeys(kind, typeAlias)
  const renamed = mapProperties(type, (p) =>
    p.alias === from
      ? { ...p, alias: to, key: p.key ?? propertyKeyFor(typeKey, from, shipped) }
      : p,
  )
  const references: RenameReference[] = []
  let next = withTypes(
    set,
    kind,
    types.map((t) => (t === type ? renamed : t)),
  )
  // A block's label names an element type's properties: `{{heading}}`.
  const label = new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, 'g')
  next = {
    ...next,
    dataTypes: next.dataTypes.map((d) => {
      let named = false
      const blocks = d.blocks?.map((b) => {
        if (b.element !== typeAlias || !b.label || !label.test(b.label)) return b
        label.lastIndex = 0
        named = true
        references.push({ in: `data type "${d.alias}"`, how: 'block label' })
        return { ...b, label: b.label.replace(label, `{{${to}}}`) }
      })
      return named ? { ...d, ...(blocks ? { blocks } : {}) } : d
    }),
    // A save-as-content workflow maps form fields to the type's properties.
    forms: next.forms?.map((f) => {
      let named = false
      const workflows = f.workflows.map((w) => {
        if (w.type !== 'saveAsContent' || w.settings['content-type'] !== typeAlias) return w
        const map = w.settings.map as Record<string, string> | undefined
        if (!map || !Object.values(map).includes(from)) return w
        named = true
        references.push({ in: `form "${f.alias}"`, how: 'save as content' })
        return {
          ...w,
          settings: {
            ...w.settings,
            map: Object.fromEntries(
              Object.entries(map).map(([field, p]) => [field, p === from ? to : p]),
            ),
          },
        }
      })
      return named ? { ...f, workflows } : f
    }),
  }
  return { ok: true, set: next, references }
}

/** A data type's alias renamed: it keeps its key, and every property using it follows. */
export function renameDataType(set: SchemaSet, from: string, to: string): RenameResult {
  const dataType = set.dataTypes.find((d) => d.alias === from)
  if (!dataType) {
    if (BUILTIN_DATA_TYPE_ALIASES.has(from))
      return refuse(`"${from}" is built in, and is not renamed`)
    return refuse(`there is no data type "${from}"`)
  }
  const problem = newAliasProblem(
    to,
    set.dataTypes.some((d) => d.alias.toLowerCase() === to.toLowerCase() && d !== dataType),
    BUILTIN_DATA_TYPE_ALIASES.has(to),
  )
  if (problem) return refuse(problem)
  const references: RenameReference[] = []
  let next: SchemaSet = {
    ...set,
    dataTypes: set.dataTypes.map(
      (d): SchemaDataType =>
        d === dataType ? { ...d, alias: to, key: d.key ?? dataTypeKeyFor(from) } : d,
    ),
  }
  for (const { kind, type } of allTypes(next)) {
    const using = allProperties(type).filter((p) => p.type === from)
    if (using.length === 0) continue
    for (const p of using)
      references.push({ in: `${nouns[kind]} "${type.alias}"`, how: `property "${p.alias}"` })
    const changed = mapProperties(type, (p) => (p.type === from ? { ...p, type: to } : p))
    next = withTypes(
      next,
      kind,
      typesOfKind(next, kind).map((t) => (t === type ? changed : t)),
    )
  }
  return { ok: true, set: next, references }
}
