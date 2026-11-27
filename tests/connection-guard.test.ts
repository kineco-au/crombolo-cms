/**
 * A lost connection in the back office: which answers mean the server can't be
 * reached, and which requests wait and are sent again once it can.
 */
import { describe, expect, test } from 'bun:test'
import {
  connectionGuardedFetch,
  ownOrigin,
  resendable,
  unreachable,
} from '../packages/backoffice-host/plugin/connection-guard-model.js'

const ORIGIN = 'https://site.example'

const answer = (status: number, type = 'text/html') =>
  new Response('x', { status, headers: { 'content-type': type } })

/** A connection that comes back when told to, counting how often it was lost. */
function connection() {
  let comeBack = () => {}
  const state = { losses: 0 }
  return {
    state,
    back: () => comeBack(),
    lost: () => {
      state.losses++
      return new Promise<void>((resolve) => {
        comeBack = resolve
      })
    },
  }
}

describe('a lost connection', () => {
  test("a gateway's answer is one; the server's own 503, as JSON, is not", () => {
    expect(unreachable(answer(502))).toBe(true)
    expect(unreachable(answer(504))).toBe(true)
    expect(unreachable(answer(503))).toBe(true)
    expect(unreachable(answer(503, 'application/problem+json'))).toBe(false)
    expect(unreachable(answer(500))).toBe(false)
    expect(unreachable(answer(200))).toBe(false)
  })

  test('reads may be sent again; writes may not', () => {
    expect(resendable('/x', undefined)).toBe(true)
    expect(resendable('/x', { method: 'HEAD' })).toBe(true)
    expect(resendable('/x', { method: 'POST' })).toBe(false)
    expect(resendable(new Request(`${ORIGIN}/x`, { method: 'PUT', body: '{}' }), undefined)).toBe(
      false,
    )
  })

  test('only requests to this site are watched', () => {
    expect(ownOrigin('/umbraco/x', ORIGIN)).toBe(true)
    expect(ownOrigin(`${ORIGIN}/x`, ORIGIN)).toBe(true)
    expect(ownOrigin('https://elsewhere.example/x', ORIGIN)).toBe(false)
  })

  test('a read that fails on the network waits for the connection, then is asked again', async () => {
    const c = connection()
    let calls = 0
    const send = async () => {
      calls++
      if (calls === 1) throw new TypeError('Failed to fetch')
      return answer(200)
    }
    const pending = connectionGuardedFetch(send, c, ORIGIN)('/umbraco/x', undefined)
    await Bun.sleep(0)
    expect(c.state.losses).toBe(1)
    c.back()
    expect((await pending).status).toBe(200)
    expect(calls).toBe(2)
  })

  test('a write that fails is not resent, and fails as it would have', async () => {
    const c = connection()
    let calls = 0
    const send = async () => {
      calls++
      throw new TypeError('Failed to fetch')
    }
    await expect(
      connectionGuardedFetch(send, c, ORIGIN)('/umbraco/x', { method: 'POST' }),
    ).rejects.toThrow('Failed to fetch')
    expect(c.state.losses).toBe(1)
    expect(calls).toBe(1)
  })

  test('another site, an abort and an ordinary error pass through untouched', async () => {
    const c = connection()
    const fetchOf = (send: () => Promise<Response>) => connectionGuardedFetch(send, c, ORIGIN)
    expect(
      (await fetchOf(async () => answer(502))('https://elsewhere.example/x', undefined)).status,
    ).toBe(502)
    const aborted = new DOMException('stopped', 'AbortError')
    await expect(
      fetchOf(async () => {
        throw aborted
      })('/x', undefined),
    ).rejects.toBe(aborted)
    expect((await fetchOf(async () => answer(500))('/x', undefined)).status).toBe(500)
    expect(c.state.losses).toBe(0)
  })
})
