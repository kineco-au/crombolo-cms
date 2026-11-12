/**
 * The words and fields of Settings → E-mail (story 340). Pure, so the unit
 * tests read it outside a browser.
 */

export const PROVIDERS = {
  resend: { label: 'Resend', key: 'API key' },
  postmark: { label: 'Postmark', key: 'Server token' },
  ses: { label: 'Amazon SES', key: 'Secret access key' },
  custom: { label: 'Your own endpoint', key: 'Bearer token (optional)' },
}

/** The fields a provider asks for, beyond the sender and its key, in order. */
export function fieldsFor(provider) {
  if (provider === 'ses')
    return [
      { name: 'sesRegion', label: 'Region', placeholder: 'ap-southeast-2' },
      { name: 'sesAccessKeyId', label: 'Access key ID' },
    ]
  if (provider === 'custom')
    return [{ name: 'url', label: 'Send to', placeholder: 'https://mail.example.com/send' }]
  if (provider === 'postmark')
    return [{ name: 'postmarkStream', label: 'Message stream (optional)', placeholder: 'outbound' }]
  return []
}

const FIELDS = [
  'provider',
  'from',
  'fromName',
  'url',
  'postmarkStream',
  'sesRegion',
  'sesAccessKeyId',
]

/**
 * The form's starting values, from what the server says is set.
 *
 * @param {Record<string, any> | undefined} view
 * @returns {Record<string, string>}
 */
export function draftOf(view) {
  /** @type {Record<string, string>} */
  const draft = { key: '' }
  for (const name of FIELDS) draft[name] = view?.[name] ?? ''
  if (!PROVIDERS[draft.provider]) draft.provider = 'resend'
  return draft
}

/**
 * What is sent to save the form: the provider's own fields, and a key only when one was typed.
 *
 * @param {Record<string, string>} draft
 * @returns {Record<string, string>}
 */
export function bodyOf(draft) {
  const own = new Set(fieldsFor(draft.provider).map((field) => field.name))
  /** @type {Record<string, string>} */
  const body = {
    provider: draft.provider,
    from: draft.from.trim(),
    fromName: draft.fromName.trim(),
  }
  for (const name of own) if (draft[name]?.trim()) body[name] = draft[name].trim()
  if (draft.key.trim()) body.key = draft.key.trim()
  return body
}

/** One sentence on where e-mail stands, for the top of the page. */
export function summaryOf(view) {
  if (!view) return ''
  if (view.source === 'off') return "E-mail is turned off by the site's configuration."
  const name = PROVIDERS[view.provider]?.label ?? view.provider
  if (view.source === 'config')
    return view.status?.available
      ? `E-mail is sent through ${name}, set by the site's configuration.`
      : "E-mail is set by the site's configuration, but can't be sent. The server's log says why."
  if (view.status?.available) return `E-mail is sent through ${name}.`
  if (view.status?.provider === 'log')
    return "E-mail is written to the server's log, not sent, until a provider is set up."
  return 'E-mail is not set up, so nothing can be sent.'
}

/** Whether the E-mail card on the Settings page carries a warning. */
export const needsAttention = (status) => Boolean(status) && !status.available
