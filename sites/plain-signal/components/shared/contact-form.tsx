/** @jsxImportSource react */
'use client'
import { type FormEvent, useEffect, useState } from 'react'

/** A field as the Delivery API's form answers it (docs/delivery-api.md, "Forms"). */
interface ApiField {
  alias: string
  type: string
  caption?: string
  helpText?: string
  mandatory?: boolean
  mandatoryMessage?: string
  placeholder?: string
  defaultValue?: string
  rows?: number
  autocomplete?: string
  options?: { value: string; label: string }[]
  condition?: {
    action: 'show' | 'hide'
    match: 'all' | 'any'
    rules: { field: string; operator: string; value?: string }[]
  }
}

interface ApiForm {
  name: string
  submitLabel?: string
  messageOnSubmit?: string
  pages: { groups: { fields: ApiField[] }[] }[]
  submit: { action: string; fields: Record<string, string>; honeypot?: string }
}

type Errors = Record<string, string>

/** Whether one condition rule holds for what has been typed so far. */
function holds(rule: { operator: string; value?: string }, answer: string): boolean {
  const expected = rule.value ?? ''
  switch (rule.operator) {
    case 'is':
      return answer === expected
    case 'isNot':
      return answer !== expected
    case 'contains':
      return answer.includes(expected)
    case 'doesNotContain':
      return !answer.includes(expected)
    case 'isEmpty':
      return answer === ''
    case 'isNotEmpty':
      return answer !== ''
    default:
      return true
  }
}

function shown(field: ApiField, answers: Record<string, string>): boolean {
  const condition = field.condition
  if (!condition || condition.rules.length === 0) return true
  const results = condition.rules.map((rule) => holds(rule, answers[rule.field] ?? ''))
  const met = condition.match === 'all' ? results.every(Boolean) : results.some(Boolean)
  return condition.action === 'show' ? met : !met
}

/**
 * The contact form as an island (story 209): it draws the form the Contact
 * page picked, from `schema/forms/` through the Delivery API, checks it as the
 * reader types, and posts it without leaving the page. Until it has mounted, and
 * wherever scripts do not run, the server's own form (its `fallback`) is there.
 */
export default function ContactForm({ alias }: { alias: string }) {
  const [form, setForm] = useState<ApiForm | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Errors>({})
  const [done, setDone] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`/umbraco/delivery/api/v2/forms/${encodeURIComponent(alias)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((loaded: ApiForm) => {
        setForm(loaded)
        const start: Record<string, string> = {}
        for (const field of loaded.pages.flatMap((p) => p.groups.flatMap((g) => g.fields)))
          if (field.defaultValue) start[field.alias] = field.defaultValue
        setAnswers(start)
      })
      .catch(() => setFailed(true))
  }, [alias])

  if (failed)
    return <p className="form-note">The form could not be loaded. Please try again shortly.</p>
  if (!form) return <p className="form-note">Loading the form…</p>
  if (done)
    return (
      <p className="form-done" role="status">
        {done}
      </p>
    )

  const fields = form.pages.flatMap((p) => p.groups.flatMap((g) => g.fields))
  const set = (alias: string, value: string) => setAnswers((now) => ({ ...now, [alias]: value }))

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    const missing: Errors = {}
    for (const field of fields)
      if (field.mandatory && shown(field, answers) && !answers[field.alias])
        missing[field.alias] = field.mandatoryMessage ?? 'This is needed'
    setErrors(missing)
    if (Object.keys(missing).length > 0) return
    setSending(true)
    const body = new FormData()
    for (const [name, value] of Object.entries(form.submit.fields)) body.append(name, value)
    if (form.submit.honeypot) body.append(form.submit.honeypot, '')
    for (const field of fields)
      if (shown(field, answers) && answers[field.alias] !== undefined)
        body.append(field.alias, answers[field.alias] as string)
    try {
      const response = await fetch(form.submit.action, {
        method: 'POST',
        body,
        headers: { accept: 'application/json' },
      })
      const answer = (await response.json()) as {
        ok: boolean
        message?: string
        errors?: { field: string; message: string }[]
      }
      if (answer.ok) setDone(answer.message ?? form.messageOnSubmit ?? 'Sent. Thank you.')
      else
        setErrors(
          Object.fromEntries((answer.errors ?? []).map((error) => [error.field, error.message])),
        )
    } catch {
      setErrors({ '': 'The message did not send. Please try again.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="contact-form" onSubmit={send} noValidate>
      {fields
        .filter((field) => shown(field, answers))
        .map((field) => (
          <Field
            key={field.alias}
            field={field}
            value={answers[field.alias] ?? ''}
            error={errors[field.alias]}
            onChange={(value) => set(field.alias, value)}
          />
        ))}
      {errors[''] ? <p className="field__error">{errors['']}</p> : null}
      <button type="submit" disabled={sending}>
        {sending ? 'Sending…' : (form.submitLabel ?? 'Send')}
      </button>
    </form>
  )
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: ApiField
  value: string
  error?: string
  onChange(value: string): void
}) {
  const id = `contact-${field.alias}`
  const described = error ? `${id}-error` : field.helpText ? `${id}-help` : undefined
  const common = {
    id,
    name: field.alias,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': described,
  }
  let control: React.ReactNode
  if (field.type === 'dataConsent')
    return (
      <div className={error ? 'field field--consent field--error' : 'field field--consent'}>
        <label>
          <input
            {...common}
            type="checkbox"
            checked={value === 'on'}
            onChange={(event) => onChange(event.target.checked ? 'on' : '')}
          />{' '}
          {field.caption}
        </label>
        {error ? (
          <p className="field__error" id={`${id}-error`}>
            {error}
          </p>
        ) : null}
      </div>
    )
  if (field.type === 'longAnswer')
    control = (
      <textarea
        {...common}
        rows={field.rows ?? 5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  else if (field.type === 'dropdown')
    control = (
      <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  else
    control = (
      <input
        {...common}
        type={field.type === 'email' ? 'email' : 'text'}
        autoComplete={field.autocomplete}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  return (
    <div className={error ? 'field field--error' : 'field'}>
      <label htmlFor={id}>
        {field.caption}
        {field.mandatory ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {field.helpText && !error ? (
        <p className="field__help" id={`${id}-help`}>
          {field.helpText}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
