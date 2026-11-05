/** What the remote commands share: the remote a command names, and the browser it opens. */
import { osKeychain } from '@crombolo/server/remote-credentials'
import { CliError } from '../errors.ts'
import { ciIdentityToken, ciTokenSource, inCiWithIdentity } from '../remote/ci.ts'
import { type Discovery, discover, RemoteClient } from '../remote/client.ts'
import { pickRemote, readRemotes } from '../remote/remotes-file.ts'

export const keychain = () => osKeychain()

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

/** The remote a command names, signed in or not, with the environment it goes to. */
export async function connectRemote(name: string | undefined, env: string | undefined) {
  const entry = pickRemote(process.cwd(), name)
  if (!entry) {
    const known = readRemotes(process.cwd())
    if (known.length === 0)
      throw new CliError('not_found', 'No remotes yet.', {
        hint: '`crombolo remote add <name> <url>` adds one.',
      })
    throw new CliError(
      name ? 'not_found' : 'usage',
      name ? `There is no remote "${name}".` : 'Which remote?',
      { hint: `Name one of: ${known.map((r) => r.name).join(', ')}.` },
    )
  }
  const discovery = await discover(entry.url)
  // In a CI job that can prove who it is, that identity; on a person's machine, their sign-in.
  const client = new RemoteClient(
    discovery,
    keychain(),
    fetch,
    inCiWithIdentity() ? ciTokensFor(discovery) : undefined,
  )
  const environment =
    env ??
    entry.environment ??
    (discovery.environments.length === 1 ? discovery.environments[0]?.id : undefined)
  return { entry, discovery, client, environment }
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
