import { type FormEvent, useState } from 'react'

interface Rule {
  field: string
  operator: string
  value: string
}

import { caps, field as fieldClasses } from '@/lib/classes'

interface Field {
  alias: string
  type: string
  caption?: string
  helpText?: string
  mandatory?: boolean
  placeholder?: string
  defaultValue?: string
  autocomplete?: string
  rows?: number
  options?: Array<{ value: string; label: string }>
  condition?: { action: 'show' | 'hide'; match: 'all' | 'any'; rules: Rule[] }
}

/** A form as the Delivery API's `forms/{key}` answers it (story 056). */
export interface FormDefinition {
  name: string
  submitLabel?: string
  messageOnSubmit?: string
  pages: Array<{ groups: Array<{ caption?: string; fields: Field[] }> }>
  submit: { action: string; fields: Record<string, string>; honeypot?: string }
}

/** Whether a field's condition lets it show, given the answers so far. */
function shown(field: Field, answers: Record<string, string>): boolean {
  const condition = field.condition
  if (!condition?.rules?.length) return true
  const results = condition.rules.map((rule) => {
    const answer = answers[rule.field] ?? ''
    return rule.operator === 'isNot' ? answer !== rule.value : answer === rule.value
  })
  const met = condition.match === 'any' ? results.some(Boolean) : results.every(Boolean)
  return condition.action === 'hide' ? !met : met
}

/**
 * The CMS's form drawn in the app, posted straight to the CMS as JSON so its
 * answer, or what needs correcting, shows here (story 208).
 */
export function EnquiryForm({ form }: { form: FormDefinition }) {
  const fields = form.pages.flatMap((page) => page.groups.flatMap((group) => group.fields))
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.alias, field.defaultValue ?? ''])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [message, setMessage] = useState('')

  const set = (alias: string, value: string) => setAnswers((old) => ({ ...old, [alias]: value }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('sending')
    const body = new FormData(event.currentTarget)
    for (const [name, value] of Object.entries(form.submit.fields)) body.set(name, value)
    try {
      const response = await fetch(form.submit.action, {
        method: 'POST',
        body,
        headers: { accept: 'application/json' },
      })
      const answer = (await response.json()) as {
        ok: boolean
        message?: string
        error?: string
        errors?: Array<{ field: string; message: string }>
      }
      if (answer.ok) {
        setState('sent')
        setMessage(answer.message ?? form.messageOnSubmit ?? 'Thank you.')
        return
      }
      setErrors(Object.fromEntries((answer.errors ?? []).map((e) => [e.field, e.message])))
      setMessage(answer.error ?? 'Some answers need another look.')
      setState('failed')
    } catch {
      setMessage('The form could not be sent. Please try again.')
      setState('failed')
    }
  }

  if (state === 'sent')
    return (
      <p role="status" className="font-display text-2xl leading-snug">
        {message}
      </p>
    )

  return (
    <form className="grid gap-6" onSubmit={submit} noValidate>
      {fields
        .filter((field) => shown(field, answers))
        .map((field) => {
          const id = `field-${field.alias}`
          const error = errors[field.alias]
          const described = [field.helpText ? `${id}-help` : '', error ? `${id}-error` : '']
            .filter(Boolean)
            .join(' ')
          const common = {
            id,
            name: field.alias,
            required: field.mandatory,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': described || undefined,
            className: field.type === 'dataConsent' ? undefined : fieldClasses,
          }
          const control =
            field.type === 'longAnswer' ? (
              <textarea
                {...common}
                rows={field.rows ?? 4}
                placeholder={field.placeholder}
                value={answers[field.alias]}
                onChange={(e) => set(field.alias, e.target.value)}
              />
            ) : field.type === 'dropdown' ? (
              <select
                {...common}
                value={answers[field.alias]}
                onChange={(e) => set(field.alias, e.target.value)}
              >
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'dataConsent' ? (
              <input
                {...common}
                className="mt-1 size-4 shrink-0 accent-brass-deep"
                type="checkbox"
                value="true"
                checked={answers[field.alias] === 'true'}
                onChange={(e) => set(field.alias, e.target.checked ? 'true' : '')}
              />
            ) : (
              <input
                {...common}
                type={field.type === 'email' ? 'email' : 'text'}
                autoComplete={field.autocomplete}
                placeholder={field.placeholder}
                value={answers[field.alias]}
                onChange={(e) => set(field.alias, e.target.value)}
              />
            )
          return (
            <div className="grid gap-2" key={field.alias}>
              {field.type === 'dataConsent' ? (
                <label htmlFor={id} className="flex items-start gap-3 text-[0.9375rem] text-ink">
                  {control} {field.caption}
                </label>
              ) : (
                <>
                  <label htmlFor={id} className={`${caps} tracking-[0.14em] text-muted`}>
                    {field.caption}
                  </label>
                  {control}
                </>
              )}
              {field.helpText ? (
                <p id={`${id}-help`} className="text-sm text-muted">
                  {field.helpText}
                </p>
              ) : null}
              {error ? (
                <p id={`${id}-error`} className="text-sm text-wine">
                  {error}
                </p>
              ) : null}
            </div>
          )
        })}
      {form.submit.honeypot ? (
        <input type="text" name={form.submit.honeypot} tabIndex={-1} autoComplete="off" hidden />
      ) : null}
      {state === 'failed' ? (
        <p role="alert" className="border border-wine bg-wine/5 p-4 text-wine">
          {message}
        </p>
      ) : null}
      <button
        className={`${caps} mt-2 min-h-11 cursor-pointer justify-self-start bg-ink px-6 text-foam hover:bg-brass-deep disabled:cursor-wait disabled:opacity-60 motion-safe:transition-colors`}
        type="submit"
        disabled={state === 'sending'}
      >
        {form.submitLabel ?? 'Send'}
      </button>
    </form>
  )
}
