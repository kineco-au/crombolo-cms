/**
 * Where a workspace or change command acts (story 386): this folder's site, reached in
 * this process through the remote protocol's own routes, or a hosted site's
 * environment, by `--profile` and `--env`. Either way the same paths answer, and every
 * command first names where it acts: `<site> › <env> (shared)` or `… › workspace <name>`.
 */

import type { Principal } from '@crombolo/api-management/domain'
import { AuthService, AuthStore } from '@crombolo/auth'
import { createServer, principalOf, REMOTE_API_PATH, type ServerHandle } from '@crombolo/server'
import { CliError } from '../errors.ts'
import { chooseSite, type ProfileFlagValues, siteFolder } from '../profiles/choose.ts'
import { problemOf } from '../remote/client.ts'
import { signedInPerson } from './acting.ts'
import { connectSite, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'

export interface WorkSite {
  kind: 'local' | 'hosted'
  /** What the site calls itself, and the environment acted on. */
  site: string
  environment: string
  /** `riverside › production (shared)`, or `… › workspace Spring sale`. */
  where(workspace?: string): string
  /** A request to the environment's routes, by their path under it: `workspaces`. */
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>
  /** The answer as JSON, or the site's refusal as an error. */
  json<T>(method: string, path: string, body?: unknown): Promise<T>
  close(): Promise<void>
}

/** Shared's key, which the workspace routes answer it by and no workspace has. */
export const SHARED = 'shared'

const whereOf = (site: string, environment: string) => (workspace?: string) =>
  `${site} › ${environment} ${workspace ? `› workspace ${workspace}` : '(shared)'}`

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const problem = await problemOf(response)
    throw new CliError(
      response.status === 409
        ? 'conflict'
        : response.status === 403
          ? 'auth'
          : response.status === 404
            ? 'not_found'
            : 'refused',
      problem.message,
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Who a command in this folder acts as: the person signed in, or the site's administrator. */
async function localPerson(server: ServerHandle): Promise<Principal> {
  const person = signedInPerson()
  if (person) return person
  const db = server.db
  const admins = await db.q
    .selectFrom('user_account as u')
    .innerJoin('user_group_member as m', 'm.user_id', 'u.id')
    .innerJoin('user_group as g', 'g.id', 'm.user_group_id')
    .select('u.id')
    .where('g.alias', '=', 'admin')
    .orderBy('u.id')
    .limit(1)
    .execute()
  const id = admins[0] ? Number(admins[0].id) : undefined
  const identity =
    id === undefined ? undefined : await new AuthService(new AuthStore(db)).identityOf(id)
  if (!identity)
    throw new CliError(
      'not_found',
      'This site has no administrator for the command line to act as.',
    )
  return principalOf(db, identity)
}

/** The site a workspace or change command acts on. */
export async function workSite(flags: ProfileFlagValues): Promise<WorkSite> {
  const chosen = chooseSite(flags, { mayDefault: false })
  if (chosen?.kind === 'hosted') {
    const { site, discovery, client, environment } = await connectSite(chosen)
    const env = needEnvironment(flags.env ?? environment, discovery)
    const call = (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      client.call(`${discovery.api}/environments/${env}/${path}`, {
        method,
        headers: {
          ...(body instanceof Uint8Array ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                body instanceof Uint8Array
                  ? (body as Uint8Array<ArrayBuffer>)
                  : JSON.stringify(body),
            }),
      })
    return {
      kind: 'hosted',
      site: site.name,
      environment: env,
      where: whereOf(site.name, env),
      call,
      json: async (method, path, body) => readJson(await call(method, path, body)),
      close: async () => {},
    }
  }
  if (chosen) process.chdir(siteFolder(chosen))
  if (flags.env !== undefined)
    throw new CliError('usage', '--env is for a hosted site.', { hint: 'Name one with --profile.' })
  const config = await siteConfig()
  const server = await createServer({ ...config, role: 'web' }, { watchSiteFiles: false })
  const person = await localPerson(server)
  const env = config.remote.environment
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    server.remoteAs(
      new Request(`http://localhost${REMOTE_API_PATH}/environments/${env}/${path}`, {
        method,
        headers: {
          ...(body instanceof Uint8Array ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                body instanceof Uint8Array
                  ? (body as Uint8Array<ArrayBuffer>)
                  : JSON.stringify(body),
            }),
      }),
      person,
    )
  return {
    kind: 'local',
    site: config.siteName,
    environment: env,
    where: whereOf(config.siteName, env),
    call,
    json: async (method, path, body) => readJson(await call(method, path, body)),
    close: () => server.close(),
  }
}

/**
 * A workspace by its name or key, among those this person may use there; `shared`, Shared
 * itself, whose routes answer under that key (story 447).
 */
export async function workspaceNamed(
  site: WorkSite,
  name: string,
): Promise<{ key: string; name: string }> {
  if (name.toLowerCase() === SHARED) return { key: SHARED, name: 'Shared' }
  const { items } = await site.json<{ items: Array<{ key: string; name: string; state: string }> }>(
    'GET',
    'workspaces',
  )
  const open = items.filter((w) => w.state === 'open' && w.key !== SHARED)
  const found =
    open.find((w) => w.key === name.toLowerCase()) ??
    open.find((w) => w.name.toLowerCase() === name.toLowerCase())
  if (!found)
    throw new CliError('not_found', `There is no open workspace "${name}" on ${site.where()}.`, {
      hint:
        open.length > 0
          ? `Open ones: ${open.map((w) => w.name).join(', ')}.`
          : '`crombolo workspace open <name>` opens one.',
    })
  return found
}
