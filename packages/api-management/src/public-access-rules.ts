/**
 * The public access dialog's two rules, for every caller that writes one: a
 * rule names member groups or members, never both and at least one, and has
 * both a sign-in page and a no-access page.
 */

export type PublicAccessRuleBreak = 'no-login-page' | 'no-error-page' | 'no-one' | 'ambiguous'

export function publicAccessRuleBreak(input: {
  loginDocumentKey: string | null | undefined
  errorDocumentKey: string | null | undefined
  memberGroupNames: readonly string[]
  memberUserNames: readonly string[]
}): PublicAccessRuleBreak | undefined {
  if (!input.loginDocumentKey) return 'no-login-page'
  if (!input.errorDocumentKey) return 'no-error-page'
  if (input.memberGroupNames.length === 0 && input.memberUserNames.length === 0) return 'no-one'
  if (input.memberGroupNames.length > 0 && input.memberUserNames.length > 0) return 'ambiguous'
  return undefined
}
