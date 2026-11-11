/**
 * What an extension's screen answered, held to the catalogue before it leaves
 * the server (story 323): unknown nodes dropped, every displayed string a
 * string, links kept only to places that cannot run script. The back office
 * renders the result as text, so this is the first of two checks, not the only
 * one. docs/extensions.md, "Screens".
 */
import type {
  Button,
  Cell,
  Condition,
  Field,
  Node,
  Row,
  Screen,
  ScreenResult,
  ScreenValue,
  ScreenValues,
  Search,
  Tab,
} from '@crombolo/extension/screens'

const NODE_TYPES = new Set([
  'table',
  'form',
  'button',
  'notice',
  'problem',
  'empty',
  'tabs',
  'progress',
])
const FIELD_KINDS = new Set([
  'text',
  'number',
  'boolean',
  'choice',
  'page',
  'media',
  'member',
  'secret',
  'list',
])
/** What a list's rows may hold (story 329). */
const LIST_SUB_KINDS = new Set(['text', 'number', 'boolean', 'choice'])
const LOOKS = new Set(['primary', 'secondary', 'danger'])
const TAG_LOOKS = new Set(['default', 'primary', 'secondary', 'positive', 'danger'])
const LIMIT = { rows: 1000, nodes: 200, fields: 100, text: 10_000 }

type Raw = Record<string, unknown>
const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A displayed string: a primitive as text, anything else empty. */
const text = (value: unknown): string => {
  if (typeof value === 'string') return value.slice(0, LIMIT.text)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}
const optionalText = (value: unknown): string | undefined =>
  value === undefined || value === null ? undefined : text(value)
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const list = (value: unknown, max: number): unknown[] =>
  Array.isArray(value) ? value.slice(0, max) : []

/** A link the back office may follow: http, https, or a path of its own. */
export function safeScreenHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined
  const trimmed = href.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^section\//.test(trimmed)) return trimmed
  // One slash: a path on this site. Two would be another host.
  if (/^\/(?!\/)/.test(trimmed) && !trimmed.includes('\\')) return trimmed
  return undefined
}

const value = (raw: unknown): ScreenValue | undefined => {
  if (raw === null) return null
  if (typeof raw === 'string') return raw.slice(0, LIMIT.text)
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'boolean') return raw
  if (Array.isArray(raw)) {
    if (raw.every((item) => typeof item === 'string')) return raw as string[]
    // A list field's rows: plain objects of primitives, nothing deeper.
    return raw.slice(0, LIMIT.rows).flatMap((item) => {
      if (!isRecord(item)) return []
      const row: Record<string, string | number | boolean | null> = {}
      for (const [key, cell] of Object.entries(item).slice(0, LIMIT.fields))
        if (
          cell === null ||
          typeof cell === 'string' ||
          typeof cell === 'boolean' ||
          (typeof cell === 'number' && Number.isFinite(cell))
        )
          row[key] = typeof cell === 'string' ? cell.slice(0, LIMIT.text) : cell
      return [row]
    })
  }
  return undefined
}

/** A plain object of values, as a form holds and an action is sent. */
export function screenValues(raw: unknown): ScreenValues {
  if (!isRecord(raw)) return {}
  const out: Record<string, ScreenValue> = {}
  for (const [key, entry] of Object.entries(raw).slice(0, LIMIT.fields)) {
    const kept = value(entry)
    if (kept !== undefined) out[key] = kept
  }
  return out
}

const condition = (raw: unknown): Condition | undefined => {
  if (!isRecord(raw) || typeof raw.field !== 'string') return undefined
  const out: Condition = { field: raw.field }
  const equals = value(raw.equals)
  if (raw.equals !== undefined && equals !== undefined) out.equals = equals
  if (Array.isArray(raw.oneOf))
    out.oneOf = raw.oneOf.map(value).filter((v): v is ScreenValue => v !== undefined)
  if (raw.notEmpty === true) out.notEmpty = true
  return out
}

interface Seen {
  dropped: Set<string>
}

const button = (raw: unknown, seen: Seen): Button | undefined => {
  if (!isRecord(raw) || raw.type !== 'button' || typeof raw.action !== 'string') {
    if (isRecord(raw)) seen.dropped.add(String(raw.type ?? 'unnamed'))
    return undefined
  }
  const out: Button = { type: 'button', label: text(raw.label), action: raw.action }
  if (raw.input !== undefined) out.input = screenValues(raw.input)
  if (typeof raw.look === 'string' && LOOKS.has(raw.look)) out.look = raw.look as Button['look']
  const confirm = optionalText(raw.confirm)
  if (confirm) out.confirm = confirm
  if (raw.submit === true) out.submit = true
  if (raw.disabled === true) out.disabled = true
  return out
}

const buttons = (raw: unknown, seen: Seen): Button[] =>
  list(raw, LIMIT.nodes)
    .map((entry) => button(entry, seen))
    .filter((entry): entry is Button => entry !== undefined)

const cell = (raw: unknown): Cell => {
  if (!isRecord(raw)) return { type: 'text', text: text(raw) }
  switch (raw.type) {
    case 'code':
      return { type: 'code', text: text(raw.text) }
    case 'tag':
      return {
        type: 'tag',
        text: text(raw.text),
        ...(typeof raw.look === 'string' && TAG_LOOKS.has(raw.look)
          ? { look: raw.look as 'default' }
          : {}),
      }
    case 'link': {
      const href = safeScreenHref(raw.href)
      // A link to anywhere else is still shown, as the words it carried.
      return href
        ? { type: 'link', text: text(raw.text), href }
        : { type: 'text', text: text(raw.text) }
    }
    case 'date': {
      const at = new Date(text(raw.value))
      return Number.isNaN(at.getTime())
        ? { type: 'text', text: '' }
        : { type: 'date', value: at.toISOString() }
    }
    default:
      return { type: 'text', text: text(raw.text) }
  }
}

const field = (raw: unknown, seen: Seen, inList = false): Field | undefined => {
  if (!isRecord(raw) || typeof raw.name !== 'string' || typeof raw.kind !== 'string') {
    return undefined
  }
  if (!FIELD_KINDS.has(raw.kind) || (inList && !LIST_SUB_KINDS.has(raw.kind))) {
    seen.dropped.add(inList ? `field ${raw.kind} in a list` : `field ${raw.kind}`)
    return undefined
  }
  const base: Record<string, unknown> = { kind: raw.kind, name: raw.name, label: text(raw.label) }
  const hint = optionalText(raw.hint)
  if (hint) base.hint = hint
  const placeholder = optionalText(raw.placeholder)
  if (placeholder) base.placeholder = placeholder
  if (raw.required === true) base.required = true
  if (raw.readOnly === true) base.readOnly = true
  const visible = condition(raw.visibleWhen)
  if (visible) base.visibleWhen = visible
  const hints = list(raw.hints, LIMIT.fields).flatMap((entry) => {
    if (!isRecord(entry)) return []
    const when = condition(entry.when)
    return when ? [{ when, text: text(entry.text) }] : []
  })
  if (hints.length > 0) base.hints = hints
  switch (raw.kind) {
    case 'text': {
      if (raw.multiline === true) base.multiline = true
      if (typeof raw.pattern === 'string') {
        try {
          new RegExp(raw.pattern, 'u')
          base.pattern = raw.pattern
        } catch {}
      }
      for (const key of ['minLength', 'maxLength'] as const) {
        const n = finite(raw[key])
        if (n !== undefined && n >= 0) base[key] = Math.floor(n)
      }
      break
    }
    case 'number':
      for (const key of ['min', 'max', 'step'] as const) {
        const n = finite(raw[key])
        if (n !== undefined) base[key] = n
      }
      break
    case 'list': {
      base.fields = list(raw.fields, LIMIT.fields)
        .map((entry) => field(entry, seen, true))
        .filter((entry): entry is Field => entry !== undefined)
      const label = optionalText(raw.addLabel)
      if (label) base.addLabel = label
      for (const key of ['min', 'max'] as const) {
        const n = finite(raw[key])
        if (n !== undefined && n >= 0) base[key] = Math.floor(n)
      }
      break
    }
    case 'choice':
      base.options = list(raw.options, LIMIT.rows).flatMap((option) =>
        isRecord(option) && typeof option.value === 'string'
          ? [{ value: option.value, label: text(option.label) }]
          : [],
      )
      break
  }
  return base as unknown as Field
}

const node = (raw: unknown, seen: Seen, inTab: boolean): Node | undefined => {
  if (!isRecord(raw)) return undefined
  const type = String(raw.type ?? '')
  if (!NODE_TYPES.has(type) || (inTab && type === 'tabs')) {
    seen.dropped.add(inTab && type === 'tabs' ? 'tabs inside tabs' : type || 'unnamed')
    return undefined
  }
  switch (type) {
    case 'table':
      return {
        type: 'table',
        columns: list(raw.columns, 50).map(text),
        rows: list(raw.rows, LIMIT.rows).flatMap((entry): Row[] =>
          isRecord(entry)
            ? [
                {
                  key: text(entry.key),
                  cells: list(entry.cells, 50).map(cell),
                  ...(entry.actions ? { actions: buttons(entry.actions, seen) } : {}),
                },
              ]
            : [],
        ),
      }
    case 'form': {
      const fields = list(raw.fields, LIMIT.fields)
        .map((entry) => field(entry, seen))
        .filter((entry): entry is Field => entry !== undefined)
      // A secret is never sent to the browser, whatever the extension put in it.
      const secrets = new Set(fields.filter((f) => f.kind === 'secret').map((f) => f.name))
      const values = Object.fromEntries(
        Object.entries(screenValues(raw.values)).filter(([key]) => !secrets.has(key)),
      )
      const title = optionalText(raw.title)
      return {
        type: 'form',
        fields,
        values,
        actions: buttons(raw.actions, seen),
        ...(title ? { title } : {}),
      }
    }
    case 'button':
      return button(raw, seen)
    case 'notice':
      return { type: 'notice', text: text(raw.text) }
    case 'problem':
      return { type: 'problem', text: text(raw.text) }
    case 'empty': {
      const body = optionalText(raw.text)
      return {
        type: 'empty',
        title: text(raw.title),
        ...(body ? { text: body } : {}),
        ...(raw.actions ? { actions: buttons(raw.actions, seen) } : {}),
      }
    }
    case 'progress': {
      const label = optionalText(raw.label)
      const at = finite(raw.value)
      return {
        type: 'progress',
        ...(label ? { label } : {}),
        ...(at !== undefined ? { value: Math.min(100, Math.max(0, at)) } : {}),
      }
    }
    case 'tabs':
      return {
        type: 'tabs',
        tabs: list(raw.tabs, 20).flatMap((entry): Tab[] =>
          isRecord(entry)
            ? [
                {
                  id: text(entry.id),
                  label: text(entry.label),
                  body: nodes(entry.body, seen, true) as Tab['body'],
                },
              ]
            : [],
        ),
      }
  }
  return undefined
}

const nodes = (raw: unknown, seen: Seen, inTab = false): Node[] =>
  list(raw, LIMIT.nodes)
    .map((entry) => node(entry, seen, inTab))
    .filter((entry): entry is Node => entry !== undefined)

const toolbarItem = (raw: unknown, seen: Seen): Button | Search | undefined => {
  if (isRecord(raw) && raw.type === 'search' && typeof raw.action === 'string') {
    const placeholder = optionalText(raw.placeholder)
    const current = optionalText(raw.value)
    return {
      type: 'search',
      action: raw.action,
      ...(placeholder ? { placeholder } : {}),
      ...(current !== undefined ? { value: current } : {}),
    }
  }
  return button(raw, seen)
}

/**
 * A view's or an action's answer, held to the catalogue. `dropped` names what
 * was left out, for the extension's log; it is never shown.
 */
export function normaliseScreenResult(answer: unknown): {
  result: ScreenResult
  dropped: string[]
} {
  const seen: Seen = { dropped: new Set() }
  const raw = isRecord(answer) && answer.type !== 'screen' ? answer.screen : answer
  const outer = isRecord(answer) && answer.type !== 'screen' ? answer : {}
  const source = isRecord(raw) ? raw : {}
  const screen: Screen = {
    type: 'screen',
    title: text(source.title),
    body: nodes(source.body, seen),
  }
  const toolbar = list(source.toolbar, 20)
    .map((entry) => toolbarItem(entry, seen))
    .filter((entry): entry is Button | Search => entry !== undefined)
  if (toolbar.length > 0) screen.toolbar = toolbar
  const result: ScreenResult = { screen }
  if (isRecord(outer.state)) {
    try {
      result.state = JSON.parse(JSON.stringify(outer.state))
    } catch {
      seen.dropped.add('state that is not plain data')
    }
  }
  const notice = optionalText(outer.notice)
  if (notice) result.notice = notice
  return { result, dropped: [...seen.dropped] }
}
