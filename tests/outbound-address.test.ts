/**
 * Story 301: where a request a user set up may go, connected to the address
 * that was checked; and which server variables a header may name.
 */
import { describe, expect, test } from 'bun:test'
import {
  checkedAddress,
  headerVariableProblem,
  OutboundRefused,
  pinnedFetch,
  refusedAddress,
} from '@crombolo/server'

describe('the addresses refused', () => {
  test('loopback, private, link-local, CGNAT, multicast, unspecified and broadcast', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.0',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '0.0.0.0',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
    ])
      expect(refusedAddress(address), address).toBeDefined()
  })

  test('an IPv4 address carried in IPv6, either way it is written', () => {
    expect(refusedAddress('::ffff:10.0.0.1')).toBe('an IPv4 address mapped into IPv6')
    expect(refusedAddress('::ffff:a00:1')).toBe('an IPv4 address mapped into IPv6')
    expect(refusedAddress('::ffff:8.8.8.8')).toBe('an IPv4 address mapped into IPv6')
  })

  test('public addresses, up to the edges of each range', () => {
    for (const address of [
      '8.8.8.8',
      '172.15.255.255',
      '172.32.0.0',
      '100.63.255.255',
      '100.128.0.0',
      '169.253.0.1',
      '2606:4700::1111',
      '2001:db8::1',
    ])
      expect(refusedAddress(address), address).toBeUndefined()
  })
})

describe('checking a URL', () => {
  const lookup = (addresses: string[]) => async () => addresses

  test('a hostname is refused if any address it has is', async () => {
    const url = new URL('https://hooks.example/in')
    await expect(
      checkedAddress(url, { lookup: lookup(['93.184.216.34', '10.0.0.1']) }),
    ).rejects.toThrow('hooks.example (10.0.0.1) is a private address')
    expect(await checkedAddress(url, { lookup: lookup(['93.184.216.34']) })).toBe('93.184.216.34')
  })

  test('an address in brackets is checked as it is, without a lookup', async () => {
    const never = async () => {
      throw new Error('looked up')
    }
    await expect(
      checkedAddress(new URL('http://[::1]:8080/x'), { lookup: never }),
    ).rejects.toBeInstanceOf(OutboundRefused)
  })

  test('only web addresses; private ones when the site allows them', async () => {
    await expect(checkedAddress(new URL('ftp://hooks.example/'))).rejects.toThrow(
      'is not a web address',
    )
    expect(
      await checkedAddress(new URL('http://127.0.0.1/'), { allowPrivateAddresses: true }),
    ).toBeUndefined()
  })
})

describe('the request', () => {
  test('goes to the address checked, the hostname kept for Host and TLS, redirects not followed', async () => {
    const sent: Array<{ url: string; init: RequestInit & { tls?: { serverName?: string } } }> = []
    const fetch = (async (url: string | URL, init: RequestInit) => {
      sent.push({ url: String(url), init })
      return new Response('ok')
    }) as typeof globalThis.fetch
    await pinnedFetch(
      'https://hooks.example:8443/in?x=1',
      { method: 'POST', body: '{}', headers: { 'x-a': '1' } },
      { lookup: async () => ['93.184.216.34'], fetch },
    )
    const [request] = sent
    expect(request?.url).toBe('https://93.184.216.34:8443/in?x=1')
    expect(new Headers(request?.init.headers).get('host')).toBe('hooks.example:8443')
    expect(new Headers(request?.init.headers).get('x-a')).toBe('1')
    expect(request?.init.tls?.serverName).toBe('hooks.example')
    expect(request?.init.redirect).toBe('manual')
  })

  test('a refused one sends nothing', async () => {
    let called = false
    const fetch = (async () => {
      called = true
      return new Response('')
    }) as unknown as typeof globalThis.fetch
    await expect(
      pinnedFetch('http://169.254.169.254/latest', {}, { fetch }),
    ).rejects.toBeInstanceOf(OutboundRefused)
    expect(called).toBe(false)
  })
})

describe('the variables a header may name', () => {
  test('one the config lists, or one starting CROMBOLO_WEBHOOK_', () => {
    expect(headerVariableProblem('X', 'PARTNER_TOKEN', ['PARTNER_TOKEN'])).toBeUndefined()
    expect(headerVariableProblem('X', 'CROMBOLO_WEBHOOK_PARTNER')).toBeUndefined()
    // The Next.js front end's shared secret, made to be sent.
    expect(headerVariableProblem('X', 'CROMBOLO_REVALIDATE_SECRET')).toBeUndefined()
    expect(headerVariableProblem('X', 'DATABASE_PASSWORD')).toContain(
      'names DATABASE_PASSWORD, which a webhook may not send',
    )
  })

  test('never another CROMBOLO_ setting, even listed', () => {
    expect(headerVariableProblem('X', 'CROMBOLO_SECRET_KEY', ['CROMBOLO_SECRET_KEY'])).toBeDefined()
  })
})
