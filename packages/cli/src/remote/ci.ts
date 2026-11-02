/**
 * Signing in to a remote from CI (story 160): the job's OIDC identity token,
 * from GitHub Actions or from GitLab's `id_tokens`, exchanged for a token that
 * acts as the site's trust rule it matches. Nothing is written anywhere: the
 * token is held in memory for the one command, and exchanged again when it runs
 * out. docs/remote-protocol.md, "Signing in from CI".
 */
import { type Discovery, RemoteError } from './client.ts'

/** GitLab: the job declares `id_tokens: { CROMBOLO_ID_TOKEN: { aud: <the site> } }`. */
export const GITLAB_ID_TOKEN_VARIABLE = 'CROMBOLO_ID_TOKEN'

type Env = Record<string, string | undefined>

/** Whether this process runs in a CI job that can prove who it is. */
export function inCiWithIdentity(env: Env = process.env): boolean {
  return Boolean(
    (env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) ||
      env[GITLAB_ID_TOKEN_VARIABLE],
  )
}

/**
 * The job's identity token for `audience`: GitHub's asked for, fresh each time,
 * or GitLab's as the job was given it. Undefined outside such a job.
 */
export async function ciIdentityToken(
  audience: string,
  env: Env = process.env,
  http: typeof fetch = fetch,
): Promise<string | undefined> {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (url && bearer) {
    const request = new URL(url)
    request.searchParams.set('audience', audience)
    const response = await http(request, { headers: { authorization: `Bearer ${bearer}` } })
    if (!response.ok)
      throw new RemoteError({
        status: 401,
        code: 'ci-identity-unavailable',
        title: 'GitHub Actions gave this job no identity token',
        detail: 'Give the job `permissions: id-token: write`.',
      })
    const { value } = (await response.json()) as { value?: string }
    return value
  }
  return env[GITLAB_ID_TOKEN_VARIABLE] || undefined
}

/** A remote's token, held in memory: exchanged from the job's identity, and again once spent. */
export function ciTokenSource(
  discovery: Discovery,
  identity: (audience: string) => Promise<string | undefined>,
  http: typeof fetch = fetch,
): (force: boolean) => Promise<string | undefined> {
  const exchange = discovery.auth.ci
  let held: { token: string; expiresAt: number } | undefined
  return async (force) => {
    if (!exchange)
      throw new RemoteError({
        status: 401,
        code: 'ci-sign-in-unsupported',
        title: `${new URL(discovery.api).origin} does not take sign-ins from CI`,
      })
    if (!force && held && held.expiresAt - 60_000 > Date.now()) return held.token
    const subject = await identity(exchange.audience)
    if (!subject) return undefined
    const response = await http(exchange.tokenExchange, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: exchange.grantType,
        subject_token: subject,
        subject_token_type: exchange.subjectTokenType,
      }),
    })
    if (!response.ok)
      // Never the identity token, nor the remote's reason: only that it was refused.
      throw new RemoteError({
        status: response.status === 429 ? 429 : 401,
        code: 'ci-sign-in-refused',
        title: `${new URL(discovery.api).origin} did not accept this job's identity`,
        detail:
          'An administrator adds a trust rule for this repository and branch, tag or environment in Settings, under CI access.',
      })
    const body = (await response.json()) as { access_token: string; expires_in: number }
    held = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
    return held.token
  }
}
