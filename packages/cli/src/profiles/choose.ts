/**
 * Which site a command acts on (story 352): `--profile`, then CROMBOLO_PROFILE,
 * then CROMBOLO_PROFILE_URL with CROMBOLO_PROFILE_ENVIRONMENT, then the
 * `default` profile, the last only for a command that always acts on a hosted
 * site. Nothing chosen is this folder's site, so the default never moves a
 * command that can act here.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setting } from '@crombolo/server/settings'
import { CliError } from '../errors.ts'
import {
  expandHome,
  isFolder,
  type Profile,
  profileNamed,
  profilesFile,
  readProfiles,
} from './profiles-file.ts'

export interface HostedSite {
  kind: 'hosted'
  /** The profile's name, or the address's host when CROMBOLO_PROFILE_URL named it. */
  name: string
  url: string
  environment?: string
  /** Whether a profile named it, so `--profile <name>` reaches it again. */
  profile: boolean
}

export interface FolderSite {
  kind: 'folder'
  name: string
  /** Absolute, `~` expanded. */
  path: string
}

export type SiteChoice = HostedSite | FolderSite

export interface ProfileFlagValues {
  profile?: string
  env?: string
  /** Gone: refused, naming `--profile`. */
  remote?: string
}

const DEFAULT = 'default'

/** The site a profile names, with `env` in place of its own environment. */
export function siteOf(profile: Profile, env?: string): SiteChoice {
  if (isFolder(profile)) {
    if (env !== undefined)
      throw new CliError(
        'usage',
        `--env is for a hosted site, and ${profile.name} is a site folder.`,
      )
    return { kind: 'folder', name: profile.name, path: expandHome(profile.path) }
  }
  // Story 386: a profile names a site; the environment is the command's own.
  if (profile.environment !== undefined)
    throw new CliError(
      'usage',
      `The profile ${profile.name} names an environment, ${profile.environment}: a profile names a site now, and each command its environment.`,
      {
        hint: `Add it again as a site profile, \`crombolo profile add ${profile.name} ${profile.url} --force\`, and pass --env ${profile.environment} to the commands that go there.`,
      },
    )
  const environment = env
  return {
    kind: 'hosted',
    name: profile.name,
    url: profile.url,
    ...(environment ? { environment } : {}),
    profile: true,
  }
}

let warned = false

/** Once a command: a folder's `remotes.toml` is not read any more, and how to move it. */
export function warnOfRemotesFile(dir: string = process.cwd()): void {
  if (warned || !existsSync(join(dir, 'remotes.toml'))) return
  warned = true
  process.stderr.write(
    '  remotes.toml here is no longer read: `crombolo profile import` copies it into your profiles.\n',
  )
}

/** A name given where `--profile` is now asked for, refused with the flag to use. */
export function refuseNamed(name: string | undefined, instead = '--profile'): void {
  if (name === undefined) return
  throw new CliError('usage', `A site is named with ${instead} now: \`${instead} ${name}\`.`)
}

/**
 * The site the flags and the environment choose, or undefined for this
 * folder's. `mayDefault` lets the `default` profile stand in for nothing.
 */
export function chooseSite(
  flags: ProfileFlagValues,
  options: { mayDefault: boolean; file?: string },
): SiteChoice | undefined {
  refuseNamed(flags.remote)
  warnOfRemotesFile()
  const file = options.file ?? profilesFile()
  const named = flags.profile ?? (setting('CROMBOLO_PROFILE') || undefined)
  if (named) return siteOf(profileNamed(named, file), flags.env)
  const url = setting('CROMBOLO_PROFILE_URL') || undefined
  if (url) {
    let host: string
    try {
      host = new URL(url).host
    } catch {
      throw new CliError('usage', `CROMBOLO_PROFILE_URL is "${url}", which is not an address.`)
    }
    const environment = flags.env ?? (setting('CROMBOLO_PROFILE_ENVIRONMENT') || undefined)
    return {
      kind: 'hosted',
      name: host,
      url,
      ...(environment ? { environment } : {}),
      profile: false,
    }
  }
  if (!options.mayDefault) return undefined
  const fallback = readProfiles(file).find((p) => p.name === DEFAULT)
  return fallback ? siteOf(fallback, flags.env) : undefined
}

/** A folder profile's site, refusing a folder that holds none. */
export function siteFolder(site: FolderSite): string {
  if (!existsSync(join(site.path, 'crombolo.config.ts')))
    throw new CliError('not_found', `${site.name} is ${site.path}, which holds no site.`, {
      hint: 'A site folder has a crombolo.config.ts.',
    })
  return site.path
}

/**
 * For a command that acts here or on another site: the hosted site chosen, or
 * undefined to act here, having moved into a folder profile's site first, so
 * the command runs as it would there.
 */
export function hostedOrHere(flags: ProfileFlagValues): HostedSite | undefined {
  const site = chooseSite(flags, { mayDefault: false })
  if (site?.kind === 'hosted') return site
  if (site) process.chdir(siteFolder(site))
  else if (flags.env !== undefined)
    throw new CliError('usage', '--env is for a hosted site.', {
      hint: 'Name one with --profile.',
    })
  return undefined
}

/**
 * The hosted site a command needs, refusing a folder, or nothing chosen, with
 * the profiles there are. `mayDefault` says whether `default` would have done.
 */
export function hostedSite(
  site: SiteChoice | undefined,
  options: { mayDefault?: boolean; file?: string } = {},
): HostedSite {
  if (site?.kind === 'hosted') return site
  if (site)
    throw new CliError('usage', `${site.name} is a site folder, and this needs a hosted site.`, {
      hint: 'Name a hosted one with --profile.',
    })
  const names = readProfiles(options.file ?? profilesFile()).map((p) => p.name)
  const listed = names.length > 0 ? `Name one with --profile: ${names.join(', ')}.` : undefined
  throw new CliError('usage', 'Which site?', {
    hint:
      options.mayDefault === false
        ? (listed ?? '`crombolo profile add <name> <url>` adds one, for --profile to name.')
        : listed
          ? `${listed} \`crombolo profile add default <url>\` makes one the site this goes to.`
          : '`crombolo profile add default <url>` adds the site this goes to; --profile names another.',
  })
}

/** `--profile <name>` for a hint, when a profile named the site. */
export const profileArg = (site: HostedSite): string =>
  site.profile ? ` --profile ${site.name}` : ''
