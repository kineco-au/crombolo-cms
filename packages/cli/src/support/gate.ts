/**
 * The sign-in a command needs before it runs (story 350): none for a `none`
 * command, the site's `cliAccess` for a `site` one, and always for a `person`
 * one. A signed-in person is checked against the section and the administrator
 * rule the command declares, as the back office checks its screen, and the
 * command acts as them. Refused before anything is opened for writing.
 */
import { hasSection } from '@crombolo/api-management/domain'
import type { AppAlias } from '@crombolo/core'
import type { BaseCommand } from '../base.ts'
import { CliError } from '../errors.ts'
import { chooseSite, type ProfileFlagValues, siteFolder } from '../profiles/choose.ts'
import { actAs } from './acting.ts'
import { readSiteSignIn, resolveSiteSignIn } from './local-sign-in.ts'
import { hostedFlags } from './remote.ts'
import { cwd, siteConfigAt } from './site.ts'

type CommandClass = typeof BaseCommand

/**
 * The site folders a command acts on: this one, or the one a folder profile
 * names. None when it acts on a hosted site, or only ever does.
 */
export async function sitesFor(
  command: CommandClass,
  flags: () => Promise<ProfileFlagValues>,
): Promise<string[]> {
  const declared = command.flags as Record<string, unknown> | undefined
  if (!declared || !('profile' in declared)) return [cwd()]
  if (declared.profile === hostedFlags.profile) return []
  // A site that cannot be chosen, or flags that do not parse, are the command's to
  // refuse in its own words: it chooses the same way before it does anything.
  try {
    const site = chooseSite(await flags(), { mayDefault: false })
    if (site?.kind === 'hosted') return []
    return [site ? siteFolder(site) : cwd()]
  } catch {
    return []
  }
}

const named = (command: CommandClass, id: string | undefined) =>
  `\`crombolo ${(id ?? command.id ?? '').replaceAll(':', ' ')}\``

const SECTIONS: Record<AppAlias, string> = {
  content: 'Content',
  media: 'Media',
  settings: 'Settings',
  users: 'Users',
  members: 'Members',
  translation: 'Translation',
  library: 'Library',
  forms: 'Forms',
  workflow: 'Workflows',
}

/** Checks each site's sign-in for the command, and has it act as the person found. */
export async function gate(command: BaseCommand, dirs: readonly string[]): Promise<void> {
  const declared = command.constructor as CommandClass
  const access = declared.access ?? 'site'
  if (access === 'none') return
  const what = named(declared, command.id)
  for (const dir of dirs) {
    const config = await siteConfigAt(dir)
    const stored = await readSiteSignIn(config)
    if (!stored) {
      if (access === 'site' && config.cliAccess === 'open') continue
      throw new CliError(
        'auth',
        access === 'person'
          ? `${what} acts as a person, so it needs you signed in to this site.`
          : `This site needs you signed in to run ${what}.`,
        { hint: 'Sign in with `crombolo login` while the site is running.' },
      )
    }
    const resolved = await resolveSiteSignIn(config, stored)
    if (resolved === 'ended')
      throw new CliError('auth', 'Your sign-in to this site has ended.', {
        hint: 'Sign in again with `crombolo login` while the site is running, or sign out with `crombolo logout`.',
      })
    const { person } = resolved
    if (declared.adminOnly && !person.isAdmin)
      throw new CliError('refused', `${what} is for administrators.`)
    const sections = declared.section === undefined ? [] : [declared.section].flat()
    if (sections.length > 0 && !sections.some((section) => hasSection(person, section)))
      throw new CliError(
        'refused',
        `${what} needs the ${sections.map((section) => SECTIONS[section]).join(' or ')} section, which your groups don't give you.`,
      )
    actAs(person)
  }
}
