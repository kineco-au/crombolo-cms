/**
 * Links for signing in through a member identity provider (story 031), for a
 * site's login form: `<a href={externalSignInUrl('entra', returnUrl)}>`. The
 * provider is one the site's config lists in `memberIdentityProviders`, by id.
 * `flow` starts another of its flows, such as `signUp` (story 191).
 */

/** Where member sign-ins through an identity provider start. */
export const MEMBER_EXTERNAL_SIGN_IN_PATH = '/umbraco/members/external'

/** The URL that signs a member in through a provider, coming back to `returnUrl` (a path on this site). */
export function externalSignInUrl(
  providerId: string,
  returnUrl?: string,
  options: { flow?: string } = {},
): string {
  const query = [
    ...(options.flow ? [`flow=${encodeURIComponent(options.flow)}`] : []),
    ...(returnUrl ? [`returnUrl=${encodeURIComponent(returnUrl)}`] : []),
  ].join('&')
  return `${MEMBER_EXTERNAL_SIGN_IN_PATH}/${encodeURIComponent(providerId)}${query ? `?${query}` : ''}`
}
