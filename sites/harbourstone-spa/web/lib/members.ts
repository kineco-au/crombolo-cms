import { CMS } from './address'

/**
 * Member sign-in from the browser: the authorization code flow with PKCE, the
 * only kind open to an app that can keep no secret. The verifier and state wait
 * in `sessionStorage` while the member signs in on the site; then the access
 * token is kept in memory and the refresh token in `sessionStorage`, for this tab.
 * docs/delivery-api.md, "Member sign-in".
 */
const SECURITY = `${CMS}/crombolo/delivery/api/v1/security/member`
const CLIENT = 'umbraco-member'
const STARTED = 'harbourstone.sign-in'
const REFRESH = 'harbourstone.refresh'

interface Tokens {
  access_token: string
  expires_in: number
  refresh_token?: string
}

let access: { token: string; expires: number } | undefined
let refreshing: Promise<string | undefined> | undefined
let finishing: Promise<string> | undefined

/** Where the site sends a member back to; registered in the CMS's crombolo.config.ts. */
const redirectUri = () => `${location.origin}/signed-in`

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

function random(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

const storedRefresh = () => {
  try {
    return sessionStorage.getItem(REFRESH) ?? undefined
  } catch {
    return undefined
  }
}

function keep(tokens: Tokens): void {
  access = { token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 }
  if (tokens.refresh_token) sessionStorage.setItem(REFRESH, tokens.refresh_token)
}

function forget(): void {
  access = undefined
  sessionStorage.removeItem(REFRESH)
}

const post = (endpoint: string, fields: Record<string, string>) =>
  fetch(`${SECURITY}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT, ...fields }),
  })

/** Sends the visitor to the site to sign in, and back to `returnTo` once they have. */
export async function signIn(returnTo: string): Promise<void> {
  const verifier = random(32)
  const state = random(16)
  sessionStorage.setItem(STARTED, JSON.stringify({ verifier, state, returnTo }))
  const query = new URLSearchParams({
    client_id: CLIENT,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid offline_access',
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
  })
  location.assign(`${SECURITY}/authorize?${query}`)
}

/** Finishes a sign-in at `/signed-in`: the code exchanged for tokens. Answers where to go next. */
export function finishSignIn(search: string): Promise<string> {
  finishing ??= (async () => {
    const query = new URLSearchParams(search)
    const started = JSON.parse(sessionStorage.getItem(STARTED) ?? 'null') as {
      verifier: string
      state: string
      returnTo: string
    } | null
    sessionStorage.removeItem(STARTED)
    const code = query.get('code')
    if (!started || !code || query.get('state') !== started.state)
      throw new Error('This sign-in was not started here.')
    const answer = await post('token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: started.verifier,
      redirect_uri: redirectUri(),
    })
    if (!answer.ok) throw new Error('The site did not accept this sign-in.')
    keep((await answer.json()) as Tokens)
    return started.returnTo
  })()
  return finishing
}

/** The member's access token, renewed once it runs out; undefined when nobody is signed in. */
export async function accessToken(): Promise<string | undefined> {
  if (access && access.expires - 30_000 > Date.now()) return access.token
  const refresh = storedRefresh()
  if (!refresh) return undefined
  refreshing ??= (async () => {
    try {
      const answer = await post('token', { grant_type: 'refresh_token', refresh_token: refresh })
      if (!answer.ok) {
        forget()
        return undefined
      }
      keep((await answer.json()) as Tokens)
      return access?.token
    } finally {
      refreshing = undefined
    }
  })()
  return refreshing
}

/** Signs the member out of the app and the site, their tokens ended, and back to the home page. */
export async function signOut(): Promise<void> {
  const refresh = storedRefresh()
  forget()
  if (refresh) await post('revoke', { token: refresh }).catch(() => undefined)
  const query = new URLSearchParams({ post_logout_redirect_uri: `${location.origin}/` })
  location.assign(`${SECURITY}/signout?${query}`)
}
