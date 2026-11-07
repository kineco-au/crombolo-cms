/**
 * A screen's own `fetch` when a session ends: it waits for someone to sign in and
 * carries on, and leaves alone what the client handles and signing in itself.
 */
import { describe, expect, test } from 'bun:test'
import { covers, guardedFetch } from '../packages/backoffice-host/plugin/session-guard-model.js'

const BASE = 'http://site.example/crombolo'

describe('which requests are looked after', () => {
  test('the back office’s own, by path or address', () => {
    expect(covers(`${BASE}/crombolo/api/forms`, undefined, BASE)).toBe(true)
    expect(covers('/crombolo/crombolo/api/forms', undefined, 'http://localhost/crombolo')).toBe(
      true,
    )
  })

  test('not another site’s, or a page’s', () => {
    expect(covers('http://other.example/crombolo/api', undefined, BASE)).toBe(false)
    expect(covers('http://site.example/about', undefined, BASE)).toBe(false)
  })

  test('not the client’s, which carry a token and have their own queue', () => {
    const init = { headers: { authorization: 'Bearer x' } }
    expect(covers(`${BASE}/management/api/v1/tree`, init, BASE)).toBe(false)
    const request = new Request(`${BASE}/management/api/v1/tree`, init)
    expect(covers(request, undefined, BASE)).toBe(false)
  })

  test('not signing in, which must never wait for itself', () => {
    const token = `${BASE}/management/api/v1/security/back-office/token`
    expect(covers(token, undefined, BASE)).toBe(false)
    expect(covers(`${BASE}/login`, undefined, BASE)).toBe(false)
  })
})

describe('a request when a session has ended', () => {
  const statuses = (...answers: number[]) => {
    const sent: unknown[] = []
    const send = async (input: unknown) => {
      sent.push(input)
      return new Response(null, { status: answers.shift() ?? 200 })
    }
    return { send: send as typeof fetch, sent }
  }
  const session = (overrides = {}) => {
    const calls = { recover: 0 }
    return {
      calls,
      covers: () => true,
      signedIn: async () => {},
      recover: async () => {
        calls.recover++
      },
      ...overrides,
    }
  }

  test('is sent again once the session is back, and the screen never sees the 401', async () => {
    const { send, sent } = statuses(401, 200)
    const s = session()
    const response = await guardedFetch(send, s)('/forms', undefined)
    expect(response.status).toBe(200)
    expect(sent).toHaveLength(2)
    expect(s.calls.recover).toBe(1)
  })

  test('a save is sent again too: a 401 means none of it was acted on', async () => {
    const { send, sent } = statuses(401, 200)
    const init = { method: 'PUT', body: '{}' }
    expect((await guardedFetch(send, session())('/forms', init)).status).toBe(200)
    expect(sent).toHaveLength(2)
  })

  test('a request with a body already read is answered as it stands', async () => {
    const { send, sent } = statuses(401)
    const request = new Request(`${BASE}/forms`, { method: 'POST', body: '{}' })
    expect((await guardedFetch(send, session())(request, undefined)).status).toBe(401)
    expect(sent).toHaveLength(1)
  })

  test('waits for someone to sign in before sending at all', async () => {
    const { send, sent } = statuses(200)
    let signIn = () => {}
    const waiting = new Promise<void>((resume) => {
      signIn = resume
    })
    const pending = guardedFetch(send, session({ signedIn: () => waiting }))('/forms', undefined)
    await Bun.sleep(1)
    expect(sent).toHaveLength(0)
    signIn()
    await pending
    expect(sent).toHaveLength(1)
  })

  test('gives up after two tries, rather than asking for ever', async () => {
    const { send, sent } = statuses(401, 401, 401, 200)
    expect((await guardedFetch(send, session())('/forms', undefined)).status).toBe(401)
    expect(sent).toHaveLength(3)
  })

  test('leaves alone what it does not look after', async () => {
    const { send, sent } = statuses(401)
    const s = session({ covers: () => false })
    expect((await guardedFetch(send, s)('/elsewhere', undefined)).status).toBe(401)
    expect(sent).toHaveLength(1)
    expect(s.calls.recover).toBe(0)
  })
})
