/** What the commands that reach a hosted site share: the flags, the connection, the browser. */
import { type UserKeychain, userKeychain } from '@crombolo/server/remote-credentials'
import { setting } from '@crombolo/server/settings'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedSite, type SiteChoice } from '../profiles/choose.ts'
import { ciIdentityToken, ciTokenSource, inCiWithIdentity } from '../remote/ci.ts'
import { type Discovery, discover, RemoteClient } from '../remote/client.ts'

let shared: UserKeychain | undefined

/** Where this person's sign-ins are kept: the keychain, or the credentials file without one. */
export const keychain = (): UserKeychain => {
  shared ??= userKeychain()
  return shared
}

const gone = Flags.string({ summary: 'gone: --profile names the site', hidden: true })

/** `--profile` and `--env`, for a command that acts here or on another site. */
export const profileFlags = {
  profile: Flags.string({
    summary: 'act on the site this profile names, rather than this one',
    helpValue: '<name>',
  }),
  env: Flags.string({ summary: "a hosted site's environment", helpValue: '<id>' }),
  remote: gone,
}

/** `--profile` for a command that always acts on a hosted site: `default` when left out. */
export const hostedFlags = {
  profile: Flags.string({
    summary: 'the hosted site, by its profile; the default profile when left out',
    helpValue: '<name>',
  }),
  remote: gone,
}

/**
 * One exchanged token per remote for the whole command, however many times it
 * connects: a remote takes each identity token once, and GitLab gives a job a
 * single one, so a deploy's check, apply and restart must share what it bought.
 */
const ciSources = new Map<string, ReturnType<typeof ciTokenSource>>()

function ciTokensFor(discovery: Discovery) {
  const origin = new URL(discovery.api).origin
  let source = ciSources.get(origin)
  if (!source) {
    source = ciTokenSource(discovery, (audience) => ciIdentityToken(audience))
    ciSources.set(origin, source)
  }
  return source
}

export function openInBrowser(url: string, disabled: boolean): void {
  if (disabled) return
  const opener =
    process.platform === 'darwin'
      ? ['open']
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '']
        : ['xdg-open']
  try {
    Bun.spawn([...opener, url], { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    // Printed already; opening it is a convenience.
  }
}

/**
 * The hosted site chosen, signed in or not, with the environment it goes to.
 * A folder, or nothing chosen, is refused: this needs a hosted site.
 */
export async function connectSite(
  choice: SiteChoice | undefined,
  options: { mayDefault?: boolean } = {},
) {
  const site: HostedSite = hostedSite(choice, options)
  const discovery = await discover(site.url)
  // A command-line token first, as the most explicit (story 351); then, in a CI job
  // that can prove who it is, that identity; on a person's machine, their sign-in.
  const token = setting('CROMBOLO_TOKEN')?.trim() || undefined
  const client = new RemoteClient(
    discovery,
    keychain(),
    fetch,
    token ? async () => token : inCiWithIdentity() ? ciTokensFor(discovery) : undefined,
    `crombolo login${site.profile ? ` --profile ${site.name}` : ''}`,
    token !== undefined,
  )
  const environment =
    site.environment ??
    (discovery.environments.length === 1 ? discovery.environments[0]?.id : undefined)
  return { site, discovery, client, environment }
}

/** The environment, or a usage error naming the ones there are. */
export function needEnvironment(
  environment: string | undefined,
  discovery: { environments: { id: string }[] },
): string {
  if (environment) return environment
  throw new CliError('usage', 'Which environment?', {
    hint: `Pass --env with one of: ${discovery.environments.map((e) => e.id).join(', ')}.`,
  })
}
