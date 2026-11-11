/**
 * A screen an extension describes and the back office draws (story 323): data
 * only, from a small catalogue, so no markup or script of the extension's
 * reaches the page. docs/extensions.md, "Screens".
 */

/** A value a form holds, or a plain object an action is sent. */
export type ScreenValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  /** A list field's rows. */
  | readonly Readonly<Record<string, string | number | boolean | null>>[]

export type ScreenValues = Readonly<Record<string, ScreenValue>>

/** When a field shows, or a hint applies, from the form's current values. */
export interface Condition {
  field: string
  equals?: ScreenValue
  oneOf?: readonly ScreenValue[]
  notEmpty?: boolean
}

export type ButtonLook = 'primary' | 'secondary' | 'danger'

export interface Button {
  type: 'button'
  label: string
  /** The action of the screen it calls. */
  action: string
  /** Sent with the action, such as a row's key. */
  input?: Readonly<Record<string, ScreenValue>>
  look?: ButtonLook
  /** Asked in the back office's own dialog before the action is called. */
  confirm?: string
  /** Sends the enclosing form's values with the action, once they pass its rules. */
  submit?: boolean
  disabled?: boolean
}

/** A search box in the toolbar: its text is sent as `input.query`. */
export interface Search {
  type: 'search'
  action: string
  placeholder?: string
  value?: string
}

export type Cell =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | {
      type: 'tag'
      text: string
      look?: 'default' | 'primary' | 'secondary' | 'positive' | 'danger'
    }
  | { type: 'link'; text: string; href: string }
  | { type: 'date'; value: string }

export interface Row {
  key: string
  cells: readonly Cell[]
  actions?: readonly Button[]
}

export interface Table {
  type: 'table'
  columns: readonly string[]
  rows: readonly Row[]
}

interface FieldBase {
  name: string
  label: string
  hint?: string
  hints?: readonly { when: Condition; text: string }[]
  visibleWhen?: Condition
  required?: boolean
  placeholder?: string
  /** Drawn disabled and never sent back: the site's code sets it, or the person may not change it. */
  readOnly?: boolean
}

export type Field =
  | (FieldBase & {
      kind: 'text'
      multiline?: boolean
      pattern?: string
      minLength?: number
      maxLength?: number
    })
  | (FieldBase & { kind: 'number'; min?: number; max?: number; step?: number })
  | (FieldBase & { kind: 'boolean' })
  | (FieldBase & { kind: 'choice'; options: readonly { value: string; label: string }[] })
  | (FieldBase & { kind: 'page' })
  | (FieldBase & { kind: 'media' })
  | (FieldBase & { kind: 'member' })
  /** Never sent back filled: the field starts empty, and is sent only when typed. */
  | (FieldBase & { kind: 'secret' })
  /**
   * Rows of sub-fields, added and removed in the browser and sent as an array
   * of objects (story 329). A sub-field is any kind but a list, a picker or a secret.
   */
  | (FieldBase & {
      kind: 'list'
      fields: readonly ListSubField[]
      addLabel?: string
      min?: number
      max?: number
    })

/** What a list's rows may hold. */
export type ListSubField = Extract<Field, { kind: 'text' | 'number' | 'boolean' | 'choice' }>

export interface Form {
  type: 'form'
  title?: string
  fields: readonly Field[]
  values: ScreenValues
  actions: readonly Button[]
}

export interface Notice {
  type: 'notice'
  text: string
}

export interface Problem {
  type: 'problem'
  text: string
}

export interface Empty {
  type: 'empty'
  title: string
  text?: string
  actions?: readonly Button[]
}

export interface Progress {
  type: 'progress'
  label?: string
  /** 0 to 100; without one the bar is indeterminate. */
  value?: number
}

export interface Tab {
  id: string
  label: string
  /** No tabs inside a tab. */
  body: readonly Exclude<Node, Tabs>[]
}

export interface Tabs {
  type: 'tabs'
  tabs: readonly Tab[]
}

export type Node = Table | Form | Button | Notice | Problem | Empty | Tabs | Progress

export interface Screen {
  type: 'screen'
  title: string
  toolbar?: readonly (Button | Search)[]
  body: readonly Node[]
}

/** What a screen's view or action answers: the screen, the state to keep, a notice. */
export interface ScreenResult<State = Record<string, unknown>> {
  screen: Screen
  state?: State
  notice?: string
}

/** A view or an action may answer the screen alone. */
export type ScreenAnswer<State = Record<string, unknown>> = Screen | ScreenResult<State>

export const screen = (
  title: string,
  body: readonly Node[],
  options: { toolbar?: readonly (Button | Search)[] } = {},
): Screen => ({ type: 'screen', title, body, ...options })

export const table = (columns: readonly string[], rows: readonly Row[]): Table => ({
  type: 'table',
  columns,
  rows,
})

export const row = (key: string, cells: readonly Cell[], actions?: readonly Button[]): Row => ({
  key,
  cells,
  ...(actions ? { actions } : {}),
})

export const cell = {
  text: (text: string): Cell => ({ type: 'text', text }),
  code: (text: string): Cell => ({ type: 'code', text }),
  tag: (text: string, look?: Extract<Cell, { type: 'tag' }>['look']): Cell => ({
    type: 'tag',
    text,
    ...(look ? { look } : {}),
  }),
  link: (text: string, href: string): Cell => ({ type: 'link', text, href }),
  date: (value: string | Date): Cell => ({
    type: 'date',
    value: value instanceof Date ? value.toISOString() : value,
  }),
}

type FieldOf<K extends Field['kind']> = Extract<Field, { kind: K }>
type FieldOptions<K extends Field['kind']> = Omit<FieldOf<K>, 'kind' | 'name' | 'label'>

const fieldOf =
  <K extends Field['kind']>(kind: K) =>
  (name: string, label: string, options: FieldOptions<K> = {} as FieldOptions<K>): FieldOf<K> =>
    ({ kind, name, label, ...options }) as FieldOf<K>

export const field = {
  text: fieldOf('text'),
  number: fieldOf('number'),
  boolean: fieldOf('boolean'),
  choice: (
    name: string,
    label: string,
    options: FieldOf<'choice'>['options'],
    rest: Omit<FieldOptions<'choice'>, 'options'> = {},
  ): FieldOf<'choice'> => ({ kind: 'choice', name, label, options, ...rest }),
  page: fieldOf('page'),
  media: fieldOf('media'),
  member: fieldOf('member'),
  secret: fieldOf('secret'),
  list: (
    name: string,
    label: string,
    fields: readonly ListSubField[],
    rest: Omit<FieldOptions<'list'>, 'fields'> = {},
  ): FieldOf<'list'> => ({ kind: 'list', name, label, fields, ...rest }),
}

export const form = (
  fields: readonly Field[],
  values: ScreenValues,
  actions: readonly Button[],
  options: { title?: string } = {},
): Form => ({ type: 'form', fields, values, actions, ...options })

export const button = (
  label: string,
  action: string,
  options: Omit<Button, 'type' | 'label' | 'action'> = {},
): Button => ({ type: 'button', label, action, ...options })

export const search = (action: string, options: Omit<Search, 'type' | 'action'> = {}): Search => ({
  type: 'search',
  action,
  ...options,
})

export const notice = (text: string): Notice => ({ type: 'notice', text })
export const problem = (text: string): Problem => ({ type: 'problem', text })
export const empty = (title: string, options: Omit<Empty, 'type' | 'title'> = {}): Empty => ({
  type: 'empty',
  title,
  ...options,
})
export const progress = (options: Omit<Progress, 'type'> = {}): Progress => ({
  type: 'progress',
  ...options,
})
export const tab = (id: string, label: string, body: Tab['body']): Tab => ({ id, label, body })
export const tabs = (list: readonly Tab[]): Tabs => ({ type: 'tabs', tabs: list })
