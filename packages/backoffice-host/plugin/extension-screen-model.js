/**
 * What the back office decides about a described screen without asking the
 * extension (story 323): which fields show, which hints apply, whether a form
 * may be sent, where a link may go and what an action sends. Pure, so it is
 * tested without a browser.
 */

const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/** Whether a condition holds over a form's current values. */
export function holds(condition, values) {
  if (!condition) return true
  const value = values?.[condition.field]
  if (condition.notEmpty && isEmpty(value)) return false
  if ('equals' in condition && value !== condition.equals) return false
  if (Array.isArray(condition.oneOf) && !condition.oneOf.includes(value)) return false
  return true
}

/** The fields a form shows now. */
export const visibleFields = (fields, values) =>
  (fields ?? []).filter((field) => holds(field.visibleWhen, values))

/** A field's hint, and the hints whose conditions hold. */
export function hintsFor(field, values) {
  return [
    ...(field.hint ? [field.hint] : []),
    ...(field.hints ?? []).filter((hint) => holds(hint.when, values)).map((hint) => hint.text),
  ]
}

/** Why each shown field cannot be sent as it is, by name; empty when the form may be sent. */
export function fieldProblems(fields, values) {
  const problems = {}
  for (const field of visibleFields(fields, values)) {
    const value = values?.[field.name]
    if (field.required && isEmpty(value) && field.kind !== 'boolean') {
      problems[field.name] = `${field.label} is required.`
      continue
    }
    // A list with a minimum is short of it even when it has no rows.
    if (isEmpty(value) && !(field.kind === 'list' && field.min)) continue
    // Story 329: a list's rows, each held to its sub-fields, and to its bounds.
    if (field.kind === 'list') {
      const rows = Array.isArray(value) ? value : []
      if (field.min !== undefined && rows.length < field.min)
        problems[field.name] = `${field.label} needs at least ${field.min}.`
      else if (field.max !== undefined && rows.length > field.max)
        problems[field.name] = `${field.label} takes at most ${field.max}.`
      else
        for (const [index, row] of rows.entries()) {
          const inner = Object.values(fieldProblems(field.fields, row))
          if (inner.length > 0) {
            problems[field.name] = `Row ${index + 1}: ${inner[0]}`
            break
          }
        }
      continue
    }
    if (field.kind === 'text') {
      const text = String(value)
      if (field.minLength !== undefined && text.length < field.minLength)
        problems[field.name] = `${field.label} needs at least ${field.minLength} characters.`
      else if (field.maxLength !== undefined && text.length > field.maxLength)
        problems[field.name] = `${field.label} takes at most ${field.maxLength} characters.`
      else if (field.pattern) {
        let matches = true
        try {
          matches = new RegExp(`^(?:${field.pattern})$`, 'u').test(text)
        } catch {}
        if (!matches) problems[field.name] = `${field.label} is not in the form it takes.`
      }
    }
    if (field.kind === 'number') {
      const n = Number(value)
      if (!Number.isFinite(n)) problems[field.name] = `${field.label} is a number.`
      else if (field.min !== undefined && n < field.min)
        problems[field.name] = `${field.label} is at least ${field.min}.`
      else if (field.max !== undefined && n > field.max)
        problems[field.name] = `${field.label} is at most ${field.max}.`
    }
  }
  return problems
}

/**
 * Where a link goes, or undefined when it may not: http and https, a path on
 * this site, or a back-office path, which is put below the back office's base.
 */
export function linkTarget(href, backOfficeBase) {
  if (typeof href !== 'string') return undefined
  const trimmed = href.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('section/')) return `${backOfficeBase.replace(/\/$/, '')}/${trimmed}`
  if (/^\/(?!\/)/.test(trimmed) && !trimmed.includes('\\')) return trimmed
  return undefined
}

/** Where a screen answers: below its extension's back-office namespace. */
export const screenUrl = (backOfficeBase, bundle, screen) =>
  `${backOfficeBase.replace(/\/$/, '')}/crombolo/api/bundle/${encodeURIComponent(bundle)}/_screen/${encodeURIComponent(screen)}`

/** The visible values of a form, with an untouched secret left out. */
export function sentValues(fields, values, typedSecrets) {
  const out = {}
  for (const field of visibleFields(fields, values)) {
    if (field.kind === 'secret' && !typedSecrets?.has(field.name)) continue
    // A read-only field is the screen's to show, never the person's to send (story 329).
    if (field.readOnly) continue
    if (values?.[field.name] !== undefined) out[field.name] = values[field.name]
  }
  return out
}

/** What a button sends: its action, its input, the form's values when it submits, and the state. */
export function actionBody(button, state, form) {
  const input = { ...(button.input ?? {}) }
  if (button.submit && form) input.values = form
  return { action: button.action, input, state: state ?? {} }
}
