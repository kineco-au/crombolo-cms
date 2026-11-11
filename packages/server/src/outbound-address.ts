/**
 * Where a request a user set up may go (story 301): never this server's own
 * network unless the site allows it, connected to the very address that was
 * checked, so DNS cannot swap it between the check and the connection. And
 * which server variables a header may name. Webhooks use it now; story 304
 * brings the forms workflow and the identity provider test. docs/webhooks.md,
 * "What a webhook may reach".
 */

/** A request refused before anything was sent; trying again would be refused the same way. */
export class OutboundRefused extends Error {
  override readonly name = 'OutboundRefused'
}

export interface OutboundOptions {
  /** Loopback, private and link-local addresses too: for development and an intranet. */
  allowPrivateAddresses?: boolean
  /** A hostname's addresses; `Bun.dns.lookup` unless a test says otherwise. */
  lookup?: (hostname: string) => Promise<string[]>
  fetch?: typeof fetch
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function ipv4Bytes(address: string): number[] | undefined {
  const match = IPV4.exec(address)
  if (!match) return undefined
  const bytes = match.slice(1).map(Number)
  return bytes.every((b) => b <= 255) ? bytes : undefined
}

function ipv6Bytes(address: string): number[] | undefined {
  if (!address.includes(':')) return undefined
  let text = address.replace(/%.*$/, '')
  const tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  const embedded = ipv4Bytes(text.slice(lastColon + 1))
  if (embedded) {
    tail.push(...embedded)
    text = `${text.slice(0, lastColon + 1)}0:0`
  }
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const groups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = groups(halves[0] ?? '')
  const rest = halves.length === 2 ? groups(halves[1] ?? '') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 0) return undefined
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  const bytes: number[] = []
  for (const group of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined
    const value = Number.parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }
  if (tail.length > 0) bytes.splice(12, 4, ...tail)
  return bytes
}

/** Whether `bytes` starts with the first `bits` of `prefix`. */
function within(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const mask = 0x80 >> (i % 8)
    if (((bytes[i >> 3] ?? 0) & mask) !== ((prefix[i >> 3] ?? 0) & mask)) return false
  }
  return true
}

const V4_REFUSED: Array<[number[], number, string]> = [
  [[0, 0, 0, 0], 8, 'an unspecified address'],
  [[10, 0, 0, 0], 8, 'a private address'],
  [[100, 64, 0, 0], 10, 'a carrier-grade NAT address'],
  [[127, 0, 0, 0], 8, 'a loopback address'],
  [[169, 254, 0, 0], 16, 'a link-local address'],
  [[172, 16, 0, 0], 12, 'a private address'],
  [[192, 168, 0, 0], 16, 'a private address'],
  [[224, 0, 0, 0], 4, 'a multicast address'],
  [[240, 0, 0, 0], 4, 'a reserved or broadcast address'],
]

const V6_REFUSED: Array<[number[], number, string]> = [
  [[0xfc], 7, 'a private address'],
  [[0xfe, 0x80], 10, 'a link-local address'],
  [[0xff], 8, 'a multicast address'],
]

/** Why an IP address is not one a request may go to, or undefined when it may. Pure. */
export function refusedAddress(address: string): string | undefined {
  const v4 = ipv4Bytes(address)
  if (v4) return V4_REFUSED.find(([prefix, bits]) => within(v4, prefix, bits))?.[2]
  const v6 = ipv6Bytes(address)
  if (!v6) return 'not an address'
  if (v6.every((b) => b === 0)) return 'an unspecified address'
  if (v6.slice(0, 15).every((b) => b === 0) && v6[15] === 1) return 'a loopback address'
  // ::ffff:a.b.c.d, and the older ::a.b.c.d: an IPv4 address carried in IPv6.
  const carried = (v6[10] === 0xff && v6[11] === 0xff) || (v6[10] === 0 && v6[11] === 0)
  if (v6.slice(0, 10).every((b) => b === 0) && carried) return 'an IPv4 address mapped into IPv6'
  return V6_REFUSED.find(([prefix, bits]) => within(v6, prefix, bits))?.[2]
}

const isIp = (host: string) => Boolean(ipv4Bytes(host) || ipv6Bytes(host))

const defaultLookup = async (hostname: string) =>
  (await Bun.dns.lookup(hostname)).map((entry) => entry.address)

/**
 * The address a request to `url` connects to, once every address its host has
 * is allowed; refused with the reason otherwise. Undefined when private
 * addresses are allowed, so the request goes as it is.
 */
export async function checkedAddress(
  url: URL,
  options: OutboundOptions = {},
): Promise<string | undefined> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new OutboundRefused(`${url.protocol} is not a web address; use http:// or https://.`)
  if (options.allowPrivateAddresses) return undefined
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIp(host) ? [host] : await (options.lookup ?? defaultLookup)(host)
  if (addresses.length === 0) throw new OutboundRefused(`${host} has no address.`)
  for (const address of addresses) {
    const reason = refusedAddress(address)
    if (reason)
      throw new OutboundRefused(
        `${host === address ? host : `${host} (${address})`} is ${reason}, which this site does not send to. CROMBOLO_ALLOW_PRIVATE_ADDRESSES allows it.`,
      )
  }
  return addresses[0]
}

/**
 * `fetch`, to the address that was checked: the hostname stays in the `Host`
 * header and in TLS, so the certificate is still verified against it.
 * Redirects are never followed; a 3xx is the receiver's answer.
 */
export async function pinnedFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  options: OutboundOptions = {},
): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  const send = options.fetch ?? fetch
  const address = await checkedAddress(url, options)
  const base = {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.body,
    signal: request.signal,
    redirect: 'manual' as const,
  }
  if (!address) return send(url, base)
  const target = new URL(url)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  target.hostname = address.includes(':') ? `[${address}]` : address
  base.headers.set('host', url.host)
  return send(target, {
    ...base,
    ...(url.protocol === 'https:' && !isIp(host) ? { tls: { serverName: host } } : {}),
  } as RequestInit)
}

/** The variables a header may name, besides those the config lists. */
export const HEADER_VARIABLE_PREFIX = 'CROMBOLO_WEBHOOK_'

/** Settings made to be sent: the Next.js front end's shared secret (docs/delivery-api.md). */
const MADE_TO_SEND = new Set(['CROMBOLO_REVALIDATE_SECRET'])

/**
 * Why a header may not send the server variable `variable`, or undefined when
 * it may: one the config lists, one starting `CROMBOLO_WEBHOOK_`, or a setting
 * made to be sent. Never any other `CROMBOLO_` setting, listed or not. Pure.
 */
export function headerVariableProblem(
  header: string,
  variable: string,
  allowed: readonly string[] = [],
): string | undefined {
  if (variable.startsWith(HEADER_VARIABLE_PREFIX) || MADE_TO_SEND.has(variable)) return undefined
  if (allowed.includes(variable) && !variable.startsWith('CROMBOLO_')) return undefined
  return `The header "${header}" names ${variable}, which a webhook may not send. List it in the config's webhooks.headerVariables, or name a variable starting ${HEADER_VARIABLE_PREFIX}.`
}
