import { type ActionContext, Outcome, ok } from '@crombolo/crombolo/routes'

/**
 * "Tell me when the next batch is out" on a bottling (story 219's demo). Nothing
 * is kept: this is a demonstration site, so the answer is all it does.
 */
export async function remindMe(formData: FormData, _context: ActionContext) {
  const email = String(formData.get('email') ?? '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return Outcome.unprocessableContent(
      [{ field: 'email', message: 'Enter an e-mail address, such as you@example.com.' }],
      'We could not take that address.',
    )
  return ok({ email })
}
