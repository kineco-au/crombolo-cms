/**
 * A member's reset link (story 282): made, kept by its hash, and sent in crombolo's words or
 * the site's, through the site's e-mail; development's log stands in for a provider. A
 * member who signs in through an identity provider is told so in place of a link.
 */
import { generateToken, hashToken } from '@crombolo/auth'
import {
  type Db,
  ExternalLoginRepository,
  externalLoginProvider,
  MemberRepository,
} from '@crombolo/data'
import type { CromboloConfig, MemberEmail } from './config.ts'
import type { EmailPort } from './email.ts'
import { logger } from './logging.ts'

/** How long a reset link works. */
export const MEMBER_RESET_HOURS = 24
const HOUR = 60 * 60 * 1000

export type ResetLinkOutcome =
  | { link: string; sent: boolean }
  | { refused: 'provider' | 'unavailable' }

export function createMemberResetLinks(
  db: Db,
  config: CromboloConfig,
  email: () => EmailPort | undefined,
) {
  const members = new MemberRepository(db)
  /** How mail reaches a member, or undefined when it cannot: development's log counts. */
  const mailer = ():
    | ((to: { name: string; email: string }, mail: MemberEmail) => Promise<void>)
    | undefined => {
    if (config.email === null) return undefined
    const port = email()
    const log = async (to: { email: string }, mail: MemberEmail) =>
      logger('members').info('E-mail to {email}: {subject}\n{text}', {
        email: to.email,
        subject: mail.subject,
        text: mail.text ?? mail.html ?? '',
      })
    if (!port || port.provider === 'none') return config.development ? log : undefined
    if (port.provider === 'log') return log
    return async (to, mail) => {
      const result = await port.send({ to: [to], ...mail })
      if (!result.ok) throw new Error(result.error)
    }
  }

  const providerOf = async (memberKey: string) => {
    const prefix = externalLoginProvider('member', '')
    const linked = (await new ExternalLoginRepository(db).forOwner(memberKey)).find((login) =>
      login.loginProvider.startsWith(prefix),
    )
    if (!linked) return undefined
    const id = linked.loginProvider.slice(prefix.length)
    return config.memberIdentityProviders.find((p) => p.oidc.id === id)?.oidc.name ?? id
  }

  const linkWords = (name: string, link: string): MemberEmail => ({
    subject: `Set your ${config.siteName} password`,
    text: [
      `Hello ${name},`,
      '',
      `Someone asked to set a new password for your account on ${config.siteName}.`,
      '',
      'Set your password:',
      link,
      '',
      `The link works once, for ${MEMBER_RESET_HOURS} hours. If this was not you, nothing has changed and you can ignore this message.`,
    ].join('\n'),
  })

  const providerWords = (name: string, provider: string): MemberEmail => ({
    subject: `Signing in to ${config.siteName}`,
    text: [
      `Hello ${name},`,
      '',
      `Someone asked to reset the password for your account on ${config.siteName}.`,
      '',
      `You sign in with ${provider}, so there is no password here to reset. Choose "Sign in with ${provider}" on the site's sign-in page. If you have forgotten your ${provider} password, reset it there.`,
      '',
      'If this was not you, you can ignore this message.',
    ].join('\n'),
  })

  const sendResetLink = async (
    member: { key: string; name: string; email: string; username: string },
    linkOptions: { origin?: string } = {},
  ): Promise<ResetLinkOutcome> => {
    const page = config.members?.resetPasswordPage
    if (!page) return { refused: 'unavailable' }
    if (await providerOf(member.key)) return { refused: 'provider' }
    const token = generateToken(32)
    await members.saveResetToken(
      member.key,
      hashToken(token),
      new Date(Date.now() + MEMBER_RESET_HOURS * HOUR),
    )
    const origin = (config.applicationUrl || linkOptions.origin || '').replace(/\/$/, '')
    const link = `${origin}${page}${page.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    const send = mailer()
    if (!send) return { link, sent: false }
    const custom = config.members?.resetPasswordEmail
    const to = { name: member.name, email: member.email }
    await send(to, custom ? await custom(member, link) : linkWords(member.name, link))
    return { link, sent: true }
  }

  return { mailer, providerOf, providerWords, sendResetLink }
}
