/** Story 282: the forms a site puts on its pages for asking for a link and setting a password. */
import { expect, test } from 'bun:test'
import {
  ForgotPasswordForm,
  MEMBER_FORGOT_PASSWORD_PATH,
  MEMBER_RESET_PASSWORD_PATH,
  ResetPasswordForm,
} from '@crombolo/render'

test('ask by e-mail address, and set a password with the link’s token', () => {
  const ask = ForgotPasswordForm({ returnUrl: '/account' }).value
  expect(ask).toContain(`action="${MEMBER_FORGOT_PASSWORD_PATH}"`)
  expect(ask).toContain('type="email" name="email"')
  expect(ask).toContain('name="returnUrl" value="/account"')
  const reset = ResetPasswordForm({ token: 'a&b', button: 'Save' }).value
  expect(reset).toContain(`action="${MEMBER_RESET_PASSWORD_PATH}"`)
  expect(reset).toContain('name="token" value="a&amp;b"')
  expect(reset).toContain('autocomplete="new-password"')
  expect(reset).toContain('>Save</button>')
  expect(ResetPasswordForm({ token: undefined }).value).not.toContain('name="token"')
})
