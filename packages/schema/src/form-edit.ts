/**
 * Changes to a form (story 251): its settings, pages, fieldsets, fields and
 * workflows, each a pure function from the form to the changed form, or the
 * reason it cannot change. Whether the site takes it is the check's to say.
 * A page or fieldset is named by its caption, or by its place, from 1.
 */
import type {
  FormCondition,
  FormSettingValue,
  FormWorkflowTrigger,
  SchemaForm,
  SchemaFormField,
  SchemaFormGroup,
  SchemaFormPage,
  SchemaFormWorkflow,
} from '@crombolo/core'
import { allFormFields } from '@crombolo/core'

export type FormEditResult = { ok: true; form: SchemaForm } | { ok: false; reason: string }

const refuse = (reason: string): FormEditResult => ({ ok: false, reason })
const done = (form: SchemaForm): FormEditResult => ({ ok: true, form })

/** "Name", "Email address": a caption from an alias when none is given. */
const captionFor = (alias: string) =>
  alias
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())

export interface FormChanges {
  name?: string
  storeEntries?: boolean
  requiresApproval?: boolean
  stepPages?: boolean
  submitLabel?: string
  nextLabel?: string
  previousLabel?: string
  /** "" takes it away. */
  messageOnSubmit?: string
  /** A page's key, or null for none. */
  redirectTo?: string | null
  theme?: string
  honeypot?: boolean
  /** 0 takes it away. */
  minimumSubmitSeconds?: number
  /** 0 takes it away. */
  maxEntries?: number
}

const text = (value: string | undefined) => (value ? value : undefined)
const positive = (value: number | undefined) => (value && value > 0 ? value : undefined)

/** The form's own settings: its name, what it keeps, its buttons and what follows sending. */
export function updateForm(form: SchemaForm, changes: FormChanges): FormEditResult {
  const next: SchemaForm = { ...form }
  if (changes.name !== undefined) next.name = changes.name
  if (changes.storeEntries !== undefined) next.storeEntries = changes.storeEntries
  if (changes.requiresApproval !== undefined) next.requiresApproval = changes.requiresApproval
  if (changes.stepPages !== undefined) next.stepPages = changes.stepPages || undefined
  if (changes.submitLabel !== undefined) next.submitLabel = text(changes.submitLabel)
  if (changes.nextLabel !== undefined) next.nextLabel = text(changes.nextLabel)
  if (changes.previousLabel !== undefined) next.previousLabel = text(changes.previousLabel)
  if (changes.messageOnSubmit !== undefined) next.messageOnSubmit = text(changes.messageOnSubmit)
  if (changes.redirectTo !== undefined) next.redirectTo = changes.redirectTo ?? undefined
  if (changes.theme !== undefined) next.theme = text(changes.theme)
  if (changes.honeypot !== undefined) next.honeypot = changes.honeypot
  if (changes.minimumSubmitSeconds !== undefined)
    next.minimumSubmitSeconds = positive(changes.minimumSubmitSeconds)
  if (changes.maxEntries !== undefined) next.maxEntries = positive(changes.maxEntries)
  return done(next)
}

/** A condition from `field=value` (is) and `field!=value` (is not) rules; null takes it away. */
export function formConditionFrom(
  rules: readonly string[],
  match: 'all' | 'any' = 'all',
): FormCondition | string {
  const parsed: FormCondition['rules'] = []
  for (const rule of rules) {
    const not = rule.indexOf('!=')
    const eq = rule.indexOf('=')
    if (eq < 1) return `"${rule}" is not a rule: write <field>=<value> or <field>!=<value>`
    if (not > 0 && not < eq)
      parsed.push({
        field: rule.slice(0, not).trim(),
        operator: 'isNot',
        value: rule.slice(not + 2),
      })
    else parsed.push({ field: rule.slice(0, eq).trim(), operator: 'is', value: rule.slice(eq + 1) })
  }
  return { action: 'show', match, rules: parsed }
}

function findPage(form: SchemaForm, ref: string): number | string {
  const n = Number(ref)
  if (Number.isInteger(n) && String(n) === ref.trim()) {
    if (n >= 1 && n <= form.pages.length) return n - 1
    return `"${form.name}" has no page ${ref}: it has ${form.pages.length}`
  }
  const index = form.pages.findIndex((p) => (p.caption ?? '').toLowerCase() === ref.toLowerCase())
  return index >= 0 ? index : `"${form.name}" has no page "${ref}"`
}

function findGroup(page: SchemaFormPage, ref: string, form: SchemaForm): number | string {
  const n = Number(ref)
  if (Number.isInteger(n) && String(n) === ref.trim()) {
    if (n >= 1 && n <= page.groups.length) return n - 1
    return `that page of "${form.name}" has no fieldset ${ref}: it has ${page.groups.length}`
  }
  const index = page.groups.findIndex((g) => (g.caption ?? '').toLowerCase() === ref.toLowerCase())
  return index >= 0 ? index : `that page of "${form.name}" has no fieldset "${ref}"`
}

/** Where a field sits: its page, fieldset and place. */
function locate(form: SchemaForm, alias: string) {
  for (const [p, page] of form.pages.entries())
    for (const [g, group] of page.groups.entries()) {
      const f = group.fields.findIndex((field) => field.alias.toLowerCase() === alias.toLowerCase())
      if (f >= 0) return { p, g, f, field: group.fields[f] as SchemaFormField }
    }
  return undefined
}

const withGroups = (
  form: SchemaForm,
  change: (page: SchemaFormPage, p: number) => SchemaFormPage,
): SchemaForm => ({ ...form, pages: form.pages.map(change) })

export interface FormFieldPlacement {
  page?: string
  group?: string
  before?: string
  after?: string
}

/** The page, fieldset and place a field goes to: the last fieldset of the last page unless said. */
function target(
  form: SchemaForm,
  at: FormFieldPlacement,
): { p: number; g: number; i: number | undefined } | string {
  const anchor = at.before ?? at.after
  if (anchor) {
    const found = locate(form, anchor)
    if (!found) return `"${form.name}" has no field "${anchor}" to put it beside`
    return { p: found.p, g: found.g, i: at.before ? found.f : found.f + 1 }
  }
  const p = at.page ? findPage(form, at.page) : form.pages.length - 1
  if (typeof p === 'string') return p
  const page = form.pages[p]
  if (!page) return `"${form.name}" has no pages`
  const g = at.group ? findGroup(page, at.group, form) : page.groups.length - 1
  if (typeof g === 'string') return g
  if (!page.groups[g]) return `that page of "${form.name}" has no fieldsets`
  return { p, g, i: undefined }
}

function insert(
  form: SchemaForm,
  field: SchemaFormField,
  at: { p: number; g: number; i: number | undefined },
) {
  return withGroups(form, (page, p) =>
    p !== at.p
      ? page
      : {
          ...page,
          groups: page.groups.map((group, g) => {
            if (g !== at.g) return group
            const fields = [...group.fields]
            fields.splice(at.i ?? fields.length, 0, field)
            return { ...group, fields }
          }),
        },
  )
}

const withoutField = (form: SchemaForm, alias: string): SchemaForm =>
  withGroups(form, (page) => ({
    ...page,
    groups: page.groups.map((group) => ({
      ...group,
      fields: group.fields.filter((f) => f.alias.toLowerCase() !== alias.toLowerCase()),
    })),
  }))

export interface FormFieldChanges {
  type?: string
  caption?: string
  helpText?: string
  mandatory?: boolean
  mandatoryMessage?: string
  pattern?: string
  patternMessage?: string
  sensitive?: boolean
  placeholder?: string
  defaultValue?: string
  /** A choice list, in order; replaces the one there. */
  values?: string[]
  /** A bundle field type's own settings, stored as given. */
  settings?: Record<string, FormSettingValue>
  /** Null takes its condition away. */
  condition?: FormCondition | null
}

function applyField(field: SchemaFormField, changes: FormFieldChanges): SchemaFormField {
  const next: SchemaFormField = { ...field }
  if (changes.type !== undefined) next.type = changes.type
  if (changes.caption !== undefined) next.caption = changes.caption
  if (changes.helpText !== undefined) next.helpText = text(changes.helpText)
  if (changes.mandatory !== undefined) next.mandatory = changes.mandatory
  if (changes.mandatoryMessage !== undefined) next.mandatoryMessage = text(changes.mandatoryMessage)
  if (changes.pattern !== undefined) next.pattern = text(changes.pattern)
  if (changes.patternMessage !== undefined) next.patternMessage = text(changes.patternMessage)
  if (changes.sensitive !== undefined) next.sensitive = changes.sensitive
  if (changes.placeholder !== undefined) next.placeholder = text(changes.placeholder)
  if (changes.defaultValue !== undefined) next.defaultValue = text(changes.defaultValue)
  if (changes.values !== undefined) next.values = [...changes.values]
  if (changes.settings !== undefined) next.settings = { ...field.settings, ...changes.settings }
  if (changes.condition !== undefined) next.condition = changes.condition ?? undefined
  return next
}

/** A field added: its alias new to the form, placed where `at` says. */
export function addFormField(
  form: SchemaForm,
  alias: string,
  type: string,
  changes: FormFieldChanges = {},
  at: FormFieldPlacement = {},
): FormEditResult {
  if (locate(form, alias)) return refuse(`"${form.name}" already has a field "${alias}"`)
  const place = target(form, at)
  if (typeof place === 'string') return refuse(place)
  const field = applyField(
    {
      alias,
      type,
      caption: captionFor(alias),
      mandatory: false,
      sensitive: false,
      values: [],
      accept: [],
    },
    changes,
  )
  return done(insert(form, field, place))
}

export function updateFormField(
  form: SchemaForm,
  alias: string,
  changes: FormFieldChanges,
): FormEditResult {
  const found = locate(form, alias)
  if (!found) return refuse(`"${form.name}" has no field "${alias}"`)
  const next = applyField(found.field, changes)
  return done(
    withGroups(form, (page, p) => ({
      ...page,
      groups: page.groups.map((group, g) => ({
        ...group,
        fields: group.fields.map((f, i) =>
          p === found.p && g === found.g && i === found.f ? next : f,
        ),
      })),
    })),
  )
}

export function moveFormField(
  form: SchemaForm,
  alias: string,
  at: FormFieldPlacement,
): FormEditResult {
  const found = locate(form, alias)
  if (!found) return refuse(`"${form.name}" has no field "${alias}"`)
  if (!at.page && !at.group && !at.before && !at.after)
    return refuse('say where: a page, a fieldset, or before or after another field')
  if ((at.before ?? at.after)?.toLowerCase() === alias.toLowerCase())
    return refuse('a field cannot go beside itself')
  const without = withoutField(form, alias)
  const place = target(without, at)
  if (typeof place === 'string') return refuse(place)
  return done(insert(without, found.field, place))
}

/** Fields whose conditions name `alias`, which removing it would leave pointing at nothing. */
const dependents = (form: SchemaForm, alias: string) =>
  [
    ...allFormFields(form)
      .filter((f) => f.condition?.rules.some((r) => r.field === alias))
      .map((f) => f.alias),
    ...form.pages.flatMap((page, p) =>
      [
        page.condition?.rules.some((r) => r.field === alias) ? `page ${p + 1}` : '',
        ...page.groups.map((g, i) =>
          g.condition?.rules.some((r) => r.field === alias)
            ? `fieldset ${i + 1} of page ${p + 1}`
            : '',
        ),
      ].filter(Boolean),
    ),
  ] as string[]

export function removeFormField(form: SchemaForm, alias: string): FormEditResult {
  const found = locate(form, alias)
  if (!found) return refuse(`"${form.name}" has no field "${alias}"`)
  const using = dependents(form, found.field.alias)
  if (using.length > 0)
    return refuse(
      `what shows depends on "${found.field.alias}" in ${using.join(', ')}: change those conditions first`,
    )
  return done(withoutField(form, alias))
}

export interface FormPlacement {
  before?: string
  after?: string
}

const placeAt = <T>(list: readonly T[], item: T, index: number | undefined): T[] => {
  const out = [...list]
  out.splice(index ?? out.length, 0, item)
  return out
}

export interface FormPageChanges {
  caption?: string
  condition?: FormCondition | null
}

/** A page added, with one empty fieldset, at the end or beside another page. */
export function addFormPage(
  form: SchemaForm,
  changes: FormPageChanges = {},
  at: FormPlacement = {},
): FormEditResult {
  const anchor = at.before ?? at.after
  let index: number | undefined
  if (anchor) {
    const found = findPage(form, anchor)
    if (typeof found === 'string') return refuse(found)
    index = at.before ? found : found + 1
  }
  const page: SchemaFormPage = {
    ...(changes.caption ? { caption: changes.caption } : {}),
    groups: [{ columns: 1, fields: [] }],
    ...(changes.condition ? { condition: changes.condition } : {}),
  }
  return done({ ...form, pages: placeAt(form.pages, page, index) })
}

export function updateFormPage(
  form: SchemaForm,
  ref: string,
  changes: FormPageChanges,
): FormEditResult {
  const p = findPage(form, ref)
  if (typeof p === 'string') return refuse(p)
  return done(
    withGroups(form, (page, i) =>
      i !== p
        ? page
        : {
            ...page,
            ...(changes.caption !== undefined ? { caption: text(changes.caption) } : {}),
            ...(changes.condition !== undefined
              ? { condition: changes.condition ?? undefined }
              : {}),
          },
    ),
  )
}

export function moveFormPage(form: SchemaForm, ref: string, at: FormPlacement): FormEditResult {
  const p = findPage(form, ref)
  if (typeof p === 'string') return refuse(p)
  const anchor = at.before ?? at.after
  if (!anchor) return refuse('say where: before or after another page')
  const page = form.pages[p] as SchemaFormPage
  const rest = form.pages.filter((_, i) => i !== p)
  const others = { ...form, pages: rest }
  const found = findPage(others, anchor)
  if (typeof found === 'string') return refuse(found)
  return done({ ...form, pages: placeAt(rest, page, at.before ? found : found + 1) })
}

const fieldsOf = (page: SchemaFormPage) => page.groups.flatMap((g) => g.fields)

/** A page removed; its fields moved to the last fieldset of another, or refused while it has any. */
export function removeFormPage(form: SchemaForm, ref: string, moveTo?: string): FormEditResult {
  const p = findPage(form, ref)
  if (typeof p === 'string') return refuse(p)
  if (form.pages.length === 1) return refuse(`"${form.name}" has only this page`)
  const page = form.pages[p] as SchemaFormPage
  const held = fieldsOf(page)
  if (held.length > 0 && !moveTo)
    return refuse(
      `that page holds ${held.length} field(s) (${held.map((f) => f.alias).join(', ')}); name a page to move them to, or move them first`,
    )
  const rest = { ...form, pages: form.pages.filter((_, i) => i !== p) }
  if (!moveTo) return done(rest)
  const named = findPage(form, moveTo)
  if (typeof named === 'string') return refuse(named)
  if (named === p) return refuse('a page cannot take its own fields')
  const t = named > p ? named - 1 : named
  return done(
    withGroups(rest, (target, i) => {
      if (i !== t) return target
      const groups = [...target.groups]
      const last = groups.length - 1
      groups[last] = {
        ...(groups[last] as SchemaFormGroup),
        fields: [...(groups[last]?.fields ?? []), ...held],
      }
      return { ...target, groups }
    }),
  )
}

export interface FormGroupChanges {
  caption?: string
  columns?: number
  condition?: FormCondition | null
}

export function addFormGroup(
  form: SchemaForm,
  pageRef: string,
  changes: FormGroupChanges = {},
  at: FormPlacement = {},
): FormEditResult {
  const p = findPage(form, pageRef)
  if (typeof p === 'string') return refuse(p)
  const page = form.pages[p] as SchemaFormPage
  const anchor = at.before ?? at.after
  let index: number | undefined
  if (anchor) {
    const found = findGroup(page, anchor, form)
    if (typeof found === 'string') return refuse(found)
    index = at.before ? found : found + 1
  }
  const group: SchemaFormGroup = {
    ...(changes.caption ? { caption: changes.caption } : {}),
    columns: changes.columns ?? 1,
    fields: [],
    ...(changes.condition ? { condition: changes.condition } : {}),
  }
  return done(
    withGroups(form, (pg, i) =>
      i !== p ? pg : { ...pg, groups: placeAt(pg.groups, group, index) },
    ),
  )
}

export function updateFormGroup(
  form: SchemaForm,
  pageRef: string,
  ref: string,
  changes: FormGroupChanges,
): FormEditResult {
  const p = findPage(form, pageRef)
  if (typeof p === 'string') return refuse(p)
  const g = findGroup(form.pages[p] as SchemaFormPage, ref, form)
  if (typeof g === 'string') return refuse(g)
  if (changes.columns !== undefined && changes.columns < 1)
    return refuse('a fieldset has at least one column')
  return done(
    withGroups(form, (page, i) =>
      i !== p
        ? page
        : {
            ...page,
            groups: page.groups.map((group, j) =>
              j !== g
                ? group
                : {
                    ...group,
                    ...(changes.caption !== undefined ? { caption: text(changes.caption) } : {}),
                    ...(changes.columns !== undefined ? { columns: changes.columns } : {}),
                    ...(changes.condition !== undefined
                      ? { condition: changes.condition ?? undefined }
                      : {}),
                  },
            ),
          },
    ),
  )
}

export function moveFormGroup(
  form: SchemaForm,
  pageRef: string,
  ref: string,
  at: FormPlacement,
): FormEditResult {
  const p = findPage(form, pageRef)
  if (typeof p === 'string') return refuse(p)
  const page = form.pages[p] as SchemaFormPage
  const g = findGroup(page, ref, form)
  if (typeof g === 'string') return refuse(g)
  const anchor = at.before ?? at.after
  if (!anchor) return refuse('say where: before or after another fieldset')
  const group = page.groups[g] as SchemaFormGroup
  const rest = page.groups.filter((_, i) => i !== g)
  const found = findGroup({ ...page, groups: rest }, anchor, form)
  if (typeof found === 'string') return refuse(found)
  return done(
    withGroups(form, (pg, i) =>
      i !== p ? pg : { ...pg, groups: placeAt(rest, group, at.before ? found : found + 1) },
    ),
  )
}

/** A fieldset removed; its fields moved to another on its page, or refused while it has any. */
export function removeFormGroup(
  form: SchemaForm,
  pageRef: string,
  ref: string,
  moveTo?: string,
): FormEditResult {
  const p = findPage(form, pageRef)
  if (typeof p === 'string') return refuse(p)
  const page = form.pages[p] as SchemaFormPage
  const g = findGroup(page, ref, form)
  if (typeof g === 'string') return refuse(g)
  if (page.groups.length === 1) return refuse('that page has only this fieldset')
  const held = (page.groups[g] as SchemaFormGroup).fields
  if (held.length > 0 && !moveTo)
    return refuse(
      `that fieldset holds ${held.length} field(s) (${held.map((f) => f.alias).join(', ')}); name a fieldset to move them to, or move them first`,
    )
  const rest = page.groups.filter((_, i) => i !== g)
  let groups = rest
  if (moveTo) {
    const named = findGroup(page, moveTo, form)
    if (typeof named === 'string') return refuse(named)
    if (named === g) return refuse('a fieldset cannot take its own fields')
    const t = named > g ? named - 1 : named
    groups = rest.map((group, i) =>
      i === t ? { ...group, fields: [...group.fields, ...held] } : group,
    )
  }
  return done(withGroups(form, (pg, i) => (i !== p ? pg : { ...pg, groups })))
}

export interface FormWorkflowChanges {
  name?: string
  on?: FormWorkflowTrigger
  /** Merged over its settings, as given. */
  settings?: Record<string, unknown>
  unset?: readonly string[]
}

const formWorkflowNamed = (form: SchemaForm, name: string) =>
  form.workflows.filter((w) => w.name.toLowerCase() === name.toLowerCase())

export function addFormWorkflow(
  form: SchemaForm,
  type: string,
  name: string,
  changes: Omit<FormWorkflowChanges, 'name' | 'unset'> = {},
): FormEditResult {
  if (formWorkflowNamed(form, name).length > 0)
    return refuse(`"${form.name}" already has a workflow "${name}"`)
  const workflow: SchemaFormWorkflow = {
    type,
    name,
    on: changes.on ?? 'submit',
    settings: { ...changes.settings },
  }
  return done({ ...form, workflows: [...form.workflows, workflow] })
}

export function updateFormWorkflow(
  form: SchemaForm,
  name: string,
  changes: FormWorkflowChanges,
): FormEditResult {
  const found = formWorkflowNamed(form, name)
  if (found.length === 0) return refuse(`"${form.name}" has no workflow "${name}"`)
  if (found.length > 1)
    return refuse(`"${form.name}" has ${found.length} workflows called "${name}"`)
  const workflow = found[0] as SchemaFormWorkflow
  if (
    changes.name &&
    changes.name.toLowerCase() !== name.toLowerCase() &&
    formWorkflowNamed(form, changes.name).length > 0
  )
    return refuse(`"${form.name}" already has a workflow "${changes.name}"`)
  const settings: Record<string, unknown> = { ...workflow.settings, ...changes.settings }
  for (const key of changes.unset ?? []) {
    if (!(key in settings)) return refuse(`the workflow "${workflow.name}" has no setting "${key}"`)
    delete settings[key]
  }
  const next: SchemaFormWorkflow = {
    ...workflow,
    ...(changes.name ? { name: changes.name } : {}),
    ...(changes.on ? { on: changes.on } : {}),
    settings,
  }
  return done({ ...form, workflows: form.workflows.map((w) => (w === workflow ? next : w)) })
}

export function removeFormWorkflow(form: SchemaForm, name: string): FormEditResult {
  const found = formWorkflowNamed(form, name)
  if (found.length === 0) return refuse(`"${form.name}" has no workflow "${name}"`)
  if (found.length > 1)
    return refuse(`"${form.name}" has ${found.length} workflows called "${name}"`)
  return done({ ...form, workflows: form.workflows.filter((w) => w !== found[0]) })
}
