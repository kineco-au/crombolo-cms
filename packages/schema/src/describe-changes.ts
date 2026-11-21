/**
 * What one file's change is, item by item (story 382): each kind from
 * `@crombolo/core`'s table, with its class, the thing it is about, and an id a
 * person accepts it by (`<kind>:<subject>`). A definition is compared as its
 * type or data type; any other file by whether it was added, changed, moved or
 * removed. Pure.
 */
import { CHANGE_CLASSES, type ChangeClass, type ChangeKind, needsAcceptance } from '@crombolo/core'
import { allProperties, type SchemaContentType, type SchemaProperty } from './model.ts'
import { parseContentType, parseDataType } from './parse.ts'

/** One item of a change. */
export interface ChangeItem {
  id: string
  kind: ChangeKind
  class: ChangeClass
  /** What it is about: `type`, `type.property`, a data type's alias, or a file's path. */
  subject: string
  /** The type and property it touches, when it is a property's. */
  type?: string
  property?: string
  /** Whether a person must accept it by name or kind before it merges or applies. */
  accept: boolean
  says: string
}

const item = (
  kind: ChangeKind,
  subject: string,
  says: string,
  at: { type?: string; property?: string } = {},
): ChangeItem => ({
  id: `${kind}:${subject}`,
  kind,
  class: CHANGE_CLASSES[kind],
  subject,
  ...at,
  accept: needsAcceptance(kind),
  says,
})

const KIND_OF_FOLDER: Record<string, 'document' | 'media' | 'member'> = {
  'content-types': 'document',
  'media-types': 'media',
  'member-types': 'member',
}

const parsedType = (path: string, text: string | null): SchemaContentType | undefined => {
  if (text === null) return undefined
  const kind = KIND_OF_FOLDER[path.split('/')[0] ?? '']
  return kind ? parseContentType(path, text, kind).value : undefined
}

function typeItems(
  before: SchemaContentType | undefined,
  after: SchemaContentType | undefined,
): ChangeItem[] {
  if (!before && !after) return []
  if (!before) {
    const type = after as SchemaContentType
    return [
      item('type-added', type.alias, `The type "${type.name}" is added.`, { type: type.alias }),
    ]
  }
  if (!after)
    return [
      item(
        'type-retired',
        before.alias,
        `The type "${before.name}" is removed; its pages keep their values, and it can be brought back.`,
        { type: before.alias },
      ),
    ]
  const out: ChangeItem[] = []
  const type = after.alias
  if (before.alias !== after.alias)
    out.push(
      item(
        'type-renamed',
        before.alias,
        `The type "${before.alias}" is renamed "${after.alias}".`,
        {
          type,
        },
      ),
    )
  if (
    before.name !== after.name ||
    (before.description ?? '') !== (after.description ?? '') ||
    before.icon !== after.icon
  )
    out.push(
      item('type-described', type, `The type "${after.name}" is described differently.`, { type }),
    )
  const was = allProperties(before)
  const now = allProperties(after)
  const match = (p: SchemaProperty, among: readonly SchemaProperty[]) =>
    (p.key ? among.find((q) => q.key === p.key) : undefined) ??
    among.find((q) => q.alias === p.alias)
  for (const p of now) {
    const old = match(p, was)
    const subject = `${type}.${p.alias}`
    const at = { type, property: p.alias }
    if (!old) {
      out.push(item('property-added', subject, `"${p.name}" is added to "${after.name}".`, at))
      continue
    }
    if (old.alias !== p.alias)
      out.push(
        item(
          'property-renamed',
          `${type}.${old.alias}`,
          `"${old.alias}" on "${after.name}" is renamed "${p.alias}".`,
          at,
        ),
      )
    if (old.type !== p.type)
      out.push(
        item(
          'property-editor-changed',
          subject,
          `"${p.name}" on "${after.name}" changes from ${old.type} to ${p.type}; values that cannot convert are lost.`,
          at,
        ),
      )
    if (!old.mandatory && p.mandatory)
      out.push(item('property-made-mandatory', subject, `"${p.name}" becomes required.`, at))
    if ((old.mandatory && !p.mandatory) || (old.regex && !p.regex))
      out.push(item('property-loosened', subject, `"${p.name}" accepts more than it did.`, at))
    if (p.regex && p.regex !== old.regex)
      out.push(
        item('property-tightened', subject, `"${p.name}" has a rule its values must meet.`, at),
      )
    if (old.variesByCulture && !p.variesByCulture)
      out.push(
        item(
          'property-made-invariant',
          subject,
          `"${p.name}" no longer varies by language; only one language's value is kept.`,
          at,
        ),
      )
    if (!old.variesByCulture && p.variesByCulture)
      out.push(item('property-made-varying', subject, `"${p.name}" varies by language.`, at))
    if (old.variesByEnvironment && !p.variesByEnvironment)
      out.push(
        item(
          'property-environments-dropped',
          subject,
          `"${p.name}" no longer varies by environment; its shared value is kept and each environment's own value is dropped.`,
          at,
        ),
      )
    if (!old.variesByEnvironment && p.variesByEnvironment)
      out.push(
        item(
          'property-varies-by-environment',
          subject,
          `"${p.name}" varies by environment, its values kept as the shared value.`,
          at,
        ),
      )
    if (old.name !== p.name || (old.description ?? '') !== (p.description ?? ''))
      out.push(item('property-described', subject, `"${p.name}" is described differently.`, at))
  }
  for (const old of was)
    if (!match(old, now))
      out.push(
        item(
          'property-retired',
          `${type}.${old.alias}`,
          `"${old.name}" is removed from "${after.name}"; its values are kept, and it can be brought back.`,
          { type, property: old.alias },
        ),
      )
  return out
}

/** The items of one file's change, by its path: in the schema folder for a definition, its own otherwise. */
export function describeFileChange(
  path: string,
  before: string | null,
  after: string | null,
  options: { definition: boolean },
): ChangeItem[] {
  if (before === after) return []
  if (options.definition) {
    const folder = path.split('/')[0] ?? ''
    if (KIND_OF_FOLDER[folder]) return typeItems(parsedType(path, before), parsedType(path, after))
    if (folder === 'data-types') {
      const was = before === null ? undefined : parseDataType(path, before).value
      const now = after === null ? undefined : parseDataType(path, after).value
      if (!was && now)
        return [item('data-type-added', now.alias, `The data type "${now.name}" is added.`)]
      if (was && !now)
        return [item('data-type-removed', was.alias, `The data type "${was.name}" is removed.`)]
      if (now) return [item('data-type-changed', now.alias, `The data type "${now.name}" changes.`)]
      return []
    }
  }
  if (before === null) return [item('file-added', path, `${path} is added.`)]
  if (after === null) return [item('file-removed', path, `${path} is removed.`)]
  return [item('file-changed', path, `${path} changes.`)]
}

/** Whether every item needing acceptance is accepted, by its id or by its kind. */
export const unaccepted = (
  items: readonly ChangeItem[],
  accepted: readonly string[],
): ChangeItem[] =>
  items.filter((i) => i.accept && !accepted.includes(i.id) && !accepted.includes(i.kind))
