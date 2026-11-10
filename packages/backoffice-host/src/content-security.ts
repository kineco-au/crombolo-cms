/**
 * The back office's content security policy (story 313): its pages talk to the
 * site, and to the origins the granted extensions declare in `http.outbound`,
 * and to nowhere else. An extension's screens run as the signed-in user, so
 * this is what stops one sending what it sees anywhere it did not declare.
 * Each page's inline scripts carry its nonce. docs/backoffice-hosting.md,
 * "Content security policy".
 */

export interface BackOfficePolicyInput {
  /** This page's nonce, on its inline scripts. */
  nonce: string
  /** The origins granted extensions declare in `http.outbound`. */
  connect?: readonly string[]
  /** Where the site's media is served from when not here: a CDN or a bucket. */
  media?: readonly string[]
  /** Pages the back office frames: the front end, for the member preview. */
  frames?: readonly string[]
  /** Where the browser reports what it blocked. */
  reportUri?: string
}

/** The oEmbed providers' players, which a rich text editor's embed shows. */
export const EMBED_FRAMES = [
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://platform.twitter.com',
]

/** Their thumbnails. */
const EMBED_IMAGES = ['https://i.ytimg.com', 'https://i.vimeocdn.com', 'https://pbs.twimg.com']

/** An origin as a policy names it, or undefined when the value is not one. */
export function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

const sources = (values: readonly (string | undefined)[]) => [
  ...new Set(values.map(originOf).filter((value): value is string => value !== undefined)),
]

/** The header's value. Pure. */
export function backOfficePolicy(input: BackOfficePolicyInput): string {
  const media = sources(input.media ?? [])
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${input.nonce}'`]],
    // The client's components set `style` attributes.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['connect-src', ["'self'", ...sources(input.connect ?? [])]],
    ['img-src', ["'self'", 'data:', 'blob:', ...media, ...EMBED_IMAGES]],
    ['media-src', ["'self'", 'blob:', ...media]],
    ['font-src', ["'self'", 'data:']],
    // The code editor's workers.
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'", ...EMBED_FRAMES, ...sources(input.frames ?? [])]],
    ['frame-ancestors', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
  ]
  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`)
  if (input.reportUri) policy.push(`report-uri ${input.reportUri}`)
  return policy.join('; ')
}

/** A fresh nonce for one page. */
export function newNonce(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
