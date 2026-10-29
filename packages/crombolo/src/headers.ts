/** The request a page renders for, mirroring `next/headers` (story 206). */
export {
  cookies,
  headers,
  type ReadonlyHeaders,
  type ReadonlyRequestCookies,
  type RequestCookie,
} from '@crombolo/render/headers'

// Decision 8 of story 209: a browser that loads this has been handed server code.
if (typeof document !== 'undefined')
  throw new Error(
    "@crombolo/crombolo/headers only runs on the server; a 'use client' component cannot import it.",
  )
