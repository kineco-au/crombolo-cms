/**
 * When a session ends, a screen's own `fetch` gets a 401 that the client never
 * hears of, so the screen shows an error and nothing asks anyone to sign in.
 * This renews the session or opens the sign-in dialog, and each request waits
 * and carries on, so the screen underneath never sees the 401.
 */
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth'
import { UmbContextConsumerController } from '@umbraco-cms/backoffice/context-api'
import { covers, guardedFetch } from './session-guard-model.js'

const base = () =>
  new URL(
    document.querySelector('base')?.getAttribute('href') ?? '/umbraco/',
    location.href,
  ).href.replace(/\/$/, '')

const sessionOf = (auth) => {
  let authorized = true
  /** Those waiting for someone to sign in. */
  const waiting = []
  let recovering

  auth.isAuthorized.subscribe((now) => {
    authorized = now
    if (now) for (const resume of waiting.splice(0)) resume()
  })
  const signedIn = () =>
    authorized ? Promise.resolve() : new Promise((resume) => waiting.push(resume))

  return {
    covers: (input, init) => covers(input, init, base()),
    signedIn,
    recover: () => {
      recovering ??= (async () => {
        const renewed = await auth.makeRefreshTokenRequest().catch(() => false)
        if (!renewed && authorized) auth.timeOut()
        await signedIn()
      })().finally(() => {
        recovering = undefined
      })
      return recovering
    },
  }
}

export const onInit = (host) => {
  new UmbContextConsumerController(host, UMB_AUTH_CONTEXT, (auth) => {
    if (auth) window.fetch = guardedFetch(window.fetch.bind(window), sessionOf(auth))
  })
}
