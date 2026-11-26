/**
 * Links for signing in through a member identity provider (story 031), for a
 * site's login form: `<a href={externalSignInUrl('entra', returnUrl)}>`. The
 * provider is one the site's config lists in `memberIdentityProviders`, by id.
 * `flow` starts another of its flows, such as `signUp` (story 191).
 */

import type { RawHtml } from './html.ts'
import { element } from './jsx-runtime.ts'

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

/** Story 282: where a member asks for a reset link, and sets the new password. */
export const MEMBER_FORGOT_PASSWORD_PATH = '/umbraco/members/forgot-password'
export const MEMBER_RESET_PASSWORD_PATH = '/umbraco/members/reset-password'

const hidden = (name: string, value: string | undefined) =>
  value ? element('input', { type: 'hidden', name, value }) : null

/**
 * A form asking for a member's reset link by their e-mail address (story 282). After it,
 * the page it returns to carries `memberResetSent=1`, `memberResetUnavailable=1` or
 * `memberTooMany=1`, for the site to say so.
 */
export function ForgotPasswordForm(
  props: { returnUrl?: string; label?: string; button?: string; className?: string } = {},
): RawHtml {
  return element('form', {
    method: 'post',
    action: MEMBER_FORGOT_PASSWORD_PATH,
    class: props.className,
    children: [
      element('label', {
        children: [
          props.label ?? 'E-mail address',
          element('input', { type: 'email', name: 'email', required: true, autocomplete: 'email' }),
        ],
      }),
      hidden('returnUrl', props.returnUrl),
      element('button', { type: 'submit', children: props.button ?? 'Send me a link' }),
    ],
  })
}

/**
 * The form on the site's reset page (`members.resetPasswordPage`, story 282), given the
 * link's token: `const { token } = await searchParams`. A refusal comes back to the page
 * with `memberResetFailed=password` (the token kept) or `memberResetFailed=expired`; a
 * reset goes on to `returnUrl` with `memberPasswordReset=1`.
 */
export function ResetPasswordForm(props: {
  token: string | undefined
  returnUrl?: string
  label?: string
  button?: string
  className?: string
}): RawHtml {
  return element('form', {
    method: 'post',
    action: MEMBER_RESET_PASSWORD_PATH,
    class: props.className,
    children: [
      hidden('token', props.token),
      element('label', {
        children: [
          props.label ?? 'New password',
          element('input', {
            type: 'password',
            name: 'password',
            required: true,
            autocomplete: 'new-password',
          }),
        ],
      }),
      hidden('returnUrl', props.returnUrl),
      element('button', { type: 'submit', children: props.button ?? 'Set my password' }),
    ],
  })
}
