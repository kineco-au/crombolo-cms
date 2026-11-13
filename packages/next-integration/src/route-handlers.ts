/**
 * Route handlers a Next.js app mounts (story 208): Draft Mode on and off from
 * the CMS's Preview button, revalidation from its webhook, a member's sign-in
 * and sign-out with PKCE, media fetched with the member's token, and the CMS's
 * changes for live reload in development (story 214).
 *
 * ```ts
 * // web/app/api/crombolo/preview/route.ts
 * export const GET = previewHandler(crombolo)
 * ```
 */
import { draftMode } from 'next/headers'
import type { Crombolo } from './index.ts'
import {
  challengeFor,
  cookie,
  type MemberSession,
  PREVIEW_COOKIE,
  randomToken,
  readCookie,
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
  type SignInState,
  sameSecret,
  seal,
  sessionSecret,
  unseal,
} from './session.ts'

/** Where member sign-in lives on the CMS. */
export const MEMBER_SECURITY_PATH = '/crombolo/delivery/api/v1/security/member'
const CLIENT_ID = 'umbraco-member'

/** A path on this app, or `/`: never another site, so a link cannot send anyone away. */
export function localPath(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
  return /[\u0000-\u001f\u007f]/.test(value) ? '/' : value
}

const secure = (request: Request) => new URL(request.url).protocol === 'https:'

function redirectTo(location: string, cookies: string[] = [], status = 307): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  for (const value of cookies) headers.append('set-cookie', value)
  return new Response(null, { status, headers })
}

/**
 * `GET ?path=…&token=…`, what the Preview button opens: the token is checked
 * against the CMS, Draft Mode is turned on, and the editor lands on the page.
 */
export function previewHandler(crombolo: Crombolo) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    const path = localPath(url.searchParams.get('path'))
    if (!token) return new Response('A preview token is required.', { status: 401 })
    // There is no endpoint that checks a token; a route lookup with it answers 401 when it is bad.
    const lookup = new URL(
      `${crombolo.options.url.replace(/\/+$/, '')}${crombolo.options.apiPath ?? '/crombolo/delivery/api/v2'}/route`,
    )
    lookup.searchParams.set('path', path)
    if (crombolo.options.host) lookup.searchParams.set('host', crombolo.options.host)
    const checked = await fetch(lookup, {
      headers: {
        preview: 'true',
        'preview-token': token,
        accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (checked.status === 401 || checked.status === 403)
      return new Response('This preview link has expired. Press Preview again.', { status: 401 })
    ;(await draftMode()).enable()
    return redirectTo(path, [
      cookie(PREVIEW_COOKIE, token, { secure: secure(request), maxAge: 60 * 60 }),
    ])
  }
}

/** `GET ?path=…`: leaves Draft Mode and forgets the preview token. */
export function exitPreviewHandler() {
  return async (request: Request): Promise<Response> => {
    ;(await draftMode()).disable()
    return redirectTo(localPath(new URL(request.url).searchParams.get('path')), [
      cookie(PREVIEW_COOKIE, '', { secure: secure(request), maxAge: 0 }),
    ])
  }
}

/**
 * `POST` from a CMS webhook with `payload = "crombolo"`: checks the shared
 * secret header and clears what holds the item and each of its ancestors.
 */
export function revalidateHandler(
  crombolo: Crombolo,
  options: { secret?: string; header?: string } = {},
) {
  return async (request: Request): Promise<Response> => {
    const secret = options.secret ?? process.env.CROMBOLO_REVALIDATE_SECRET
    if (!secret) return new Response('CROMBOLO_REVALIDATE_SECRET is not set.', { status: 500 })
    if (!(await sameSecret(request.headers.get(options.header ?? 'x-crombolo-secret'), secret)))
      return new Response('Unauthorized', { status: 401 })
    let body: { Id?: unknown; Ancestors?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return new Response('Expected the webhook payload as JSON.', { status: 400 })
    }
    const keys = [body.Id, ...(Array.isArray(body.Ancestors) ? body.Ancestors : [])].filter(
      (key): key is string => typeof key === 'string' && /^[0-9a-f-]{36}$/i.test(key),
    )
    if (keys.length === 0) return new Response('The payload names no item.', { status: 400 })
    crombolo.revalidate(keys)
    announceRevalidation(keys)
    return Response.json({ revalidated: keys })
  }
}

interface TokenAnswer {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

const sessionFrom = (answer: TokenAnswer): MemberSession => ({
  accessToken: answer.access_token,
  ...(answer.refresh_token ? { refreshToken: answer.refresh_token } : {}),
  expiresAt: Date.now() + (answer.expires_in ?? 300) * 1000,
})

/** Asks the CMS's token endpoint, by authorization code or refresh token. */
export async function requestTokens(
  crombolo: Crombolo,
  form: Record<string, string>,
): Promise<MemberSession | undefined> {
  const response = await fetch(
    `${crombolo.options.url.replace(/\/+$/, '')}${MEMBER_SECURITY_PATH}/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...form }),
      cache: 'no-store',
    },
  )
  if (!response.ok) return undefined
  return sessionFrom((await response.json()) as TokenAnswer)
}

export interface MemberHandlerOptions {
  /** This app's callback address, registered in the CMS's `deliveryApi.memberAuthorization`. */
  redirectUri: string
  /** Where the CMS sends the member after signing out; registered there too. */
  postLogoutRedirectUri: string
}

/** Sign-in, its callback, and sign-out, for a member of the site. */
export function memberHandlers(crombolo: Crombolo, options: MemberHandlerOptions) {
  const cms = crombolo.options.url.replace(/\/+$/, '')
  const secretOf = () => sessionSecret(crombolo.options.secret ?? process.env.CROMBOLO_NEXT_SECRET)

  return {
    /** `GET ?returnTo=/path`: off to the CMS to sign in. */
    async signIn(request: Request): Promise<Response> {
      const state = randomToken()
      const verifier = randomToken(48)
      const pending: SignInState = {
        state,
        verifier,
        returnTo: localPath(new URL(request.url).searchParams.get('returnTo')),
      }
      const authorize = new URL(`${cms}${MEMBER_SECURITY_PATH}/authorize`)
      authorize.search = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: options.redirectUri,
        response_type: 'code',
        scope: 'openid offline_access',
        code_challenge: await challengeFor(verifier),
        code_challenge_method: 'S256',
        state,
      }).toString()
      return redirectTo(authorize.toString(), [
        cookie(SIGN_IN_COOKIE, await seal(pending, secretOf()), {
          secure: secure(request),
          maxAge: 10 * 60,
        }),
      ])
    },

    /** `GET ?code=…&state=…`: the tokens, sealed into the session cookie. */
    async callback(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const pending = await unseal<SignInState>(
        readCookie(request.headers.get('cookie'), SIGN_IN_COOKIE),
        secretOf(),
      )
      const code = url.searchParams.get('code')
      const done = cookie(SIGN_IN_COOKIE, '', { secure: secure(request), maxAge: 0 })
      if (!pending || !code || url.searchParams.get('state') !== pending.state)
        return new Response('This sign-in has expired. Please sign in again.', {
          status: 400,
          headers: { 'set-cookie': done },
        })
      const session = await requestTokens(crombolo, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: options.redirectUri,
        code_verifier: pending.verifier,
      })
      if (!session)
        return new Response('Signing in did not complete. Please try again.', {
          status: 400,
          headers: { 'set-cookie': done },
        })
      return redirectTo(pending.returnTo, [
        done,
        cookie(SESSION_COOKIE, await seal(session, secretOf()), {
          secure: secure(request),
          maxAge: 60 * 60 * 24 * 30,
        }),
      ])
    },

    /** `GET`: ends the member's tokens and their CMS session, then comes back. */
    async signOut(request: Request): Promise<Response> {
      const session = await unseal<MemberSession>(
        readCookie(request.headers.get('cookie'), SESSION_COOKIE),
        secretOf(),
      )
      if (session?.refreshToken)
        await fetch(`${cms}${MEMBER_SECURITY_PATH}/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: CLIENT_ID, token: session.refreshToken }),
          cache: 'no-store',
        }).catch(() => undefined)
      const signout = new URL(`${cms}${MEMBER_SECURITY_PATH}/signout`)
      signout.search = new URLSearchParams({
        post_logout_redirect_uri: options.postLogoutRedirectUri,
      }).toString()
      return redirectTo(signout.toString(), [
        cookie(SESSION_COOKIE, '', { secure: secure(request), maxAge: 0 }),
      ])
    },
  }
}

/**
 * `GET /media/…`: the CMS's media file, sent with the member's token when one
 * is signed in, so protected media reaches who may read it. Mount it at
 * `web/app/media/[...path]/route.ts`.
 */
export function mediaHandler(crombolo: Crombolo) {
  const cms = crombolo.options.url.replace(/\/+$/, '')
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const headers = new Headers()
    for (const name of ['accept', 'if-none-match', 'if-modified-since', 'range'])
      if (request.headers.has(name)) headers.set(name, request.headers.get(name) as string)
    const secret = crombolo.options.secret ?? process.env.CROMBOLO_NEXT_SECRET
    const session =
      secret && secret.length >= 32
        ? await unseal<MemberSession>(
            readCookie(request.headers.get('cookie'), SESSION_COOKIE),
            secret,
          )
        : undefined
    if (session && session.expiresAt > Date.now())
      headers.set('authorization', `Bearer ${session.accessToken}`)
    const answer = await fetch(`${cms}${url.pathname}${url.search}`, {
      headers,
      cache: 'no-store',
      signal: request.signal,
    })
    const out = new Headers()
    for (const name of [
      'content-type',
      'content-length',
      'cache-control',
      'etag',
      'last-modified',
      'content-range',
      'accept-ranges',
    ])
      if (answer.headers.has(name)) out.set(name, answer.headers.get(name) as string)
    // An answer to a member's token is theirs alone.
    if (headers.has('authorization')) out.set('cache-control', 'private, no-store')
    return new Response(answer.body, { status: answer.status, headers: out })
  }
}

/** Where the CMS streams its changes in development. */
export const CMS_LIVE_EVENTS_PATH = '/crombolo/dev/events'

/**
 * On the global object: Next.js may bundle this module once per route, and
 * the revalidate route must reach the live route's listeners.
 */
const REVALIDATED = Symbol.for('crombolo.next.revalidated')

function revalidationListeners(): Set<(keys: readonly string[]) => void> {
  const holder = globalThis as { [REVALIDATED]?: Set<(keys: readonly string[]) => void> }
  holder[REVALIDATED] ??= new Set()
  return holder[REVALIDATED]
}

function announceRevalidation(keys: readonly string[]): void {
  for (const listener of revalidationListeners()) listener(keys)
}

const encoder = new TextEncoder()

/**
 * `GET` for `<CromboloLiveReload />` in development: the CMS's change stream,
 * and a `revalidated` event once this app has cleared what a webhook named, so
 * a refresh after it shows the new content. 404 outside development.
 */
export function liveReloadHandler(crombolo: Crombolo) {
  return async (request: Request): Promise<Response> => {
    if (process.env.NODE_ENV !== 'development') return new Response('Not Found', { status: 404 })
    const upstream = await fetch(new URL(CMS_LIVE_EVENTS_PATH, crombolo.options.url), {
      headers: { accept: 'text/event-stream' },
      signal: request.signal,
    }).catch(() => undefined)
    if (!upstream?.ok || !upstream.body)
      return new Response('The CMS is not streaming its changes.', { status: 502 })
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let listener: ((keys: readonly string[]) => void) | undefined
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        listener = (keys) =>
          controller.enqueue(
            encoder.encode(`event: revalidated\ndata: ${JSON.stringify({ keys })}\n\n`),
          )
        revalidationListeners().add(listener)
        // Whole frames only, so a `revalidated` event never lands inside one of the CMS's.
        let buffered = ''
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffered += decoder.decode(value, { stream: true })
            const end = buffered.lastIndexOf('\n\n')
            if (end < 0) continue
            controller.enqueue(encoder.encode(buffered.slice(0, end + 2)))
            buffered = buffered.slice(end + 2)
          }
        } catch {
          // The page left, or the CMS restarted; the browser reconnects either way.
        } finally {
          if (listener) revalidationListeners().delete(listener)
          try {
            controller.close()
          } catch {}
        }
      },
      cancel() {
        if (listener) revalidationListeners().delete(listener)
        void reader.cancel().catch(() => {})
      },
    })
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
