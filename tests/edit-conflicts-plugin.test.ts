/**
 * Story 172: the backoffice remembers the revision each editor loaded and
 * sends it back, so the server can refuse a save from an older copy.
 */
import { describe, expect, test } from 'bun:test'
import {
  createRevisionTracker,
  entityLoads,
} from '../packages/backoffice-host/plugin/edit-conflicts.js'

const KEY = '0b8f5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const PAGE = `http://local/umbraco/management/api/v1/document/${KEY}`

const read = (etag: string, status = 200) => new Response('{}', { status, headers: { etag } })
const request = (url: string, method = 'GET', headers: Record<string, string> = {}) =>
  new Request(url, { method, headers })

describe('the revision an editor works from', () => {
  test("is set by the editor's own load, not by any other read of the page", () => {
    const revisions = createRevisionTracker()
    revisions.onResponse(read('"1.1"'), request(PAGE))
    expect(revisions.revisionOf(KEY)).toBeUndefined()
    revisions.beginLoad(KEY)
    revisions.onResponse(read('"2.5"'), request(PAGE))
    revisions.endLoad(KEY)
    expect(revisions.revisionOf(KEY)).toBe('"2.5"')
    // A tree action reading the page later must not make the editor's copy look current.
    revisions.onResponse(read('"3.6"'), request(PAGE))
    expect(revisions.revisionOf(KEY)).toBe('"2.5"')
  })

  test("goes with the page's writes, and a successful write moves it on", () => {
    const revisions = createRevisionTracker()
    revisions.beginLoad(KEY)
    revisions.onResponse(read('"2.5"'), request(PAGE))
    revisions.endLoad(KEY)
    for (const path of ['', '/update-and-publish', '/publish', '/patch']) {
      const sent = revisions.onRequest(request(`${PAGE}${path}`, 'PUT'))
      expect(sent.headers.get('if-match')).toBe('"2.5"')
    }
    // Not other writes, and never over an If-Match the caller chose.
    expect(
      revisions.onRequest(request(`${PAGE}/move-to-recycle-bin`, 'PUT')).headers.get('if-match'),
    ).toBeNull()
    expect(
      revisions.onRequest(request(PAGE, 'PUT', { 'if-match': '*' })).headers.get('if-match'),
    ).toBe('*')
    revisions.onResponse(read('"3.7"'), request(PAGE, 'PUT'))
    expect(revisions.revisionOf(KEY)).toBe('"3.7"')
  })

  test('a refused save is a conflict until the editor saves or loads again', () => {
    const revisions = createRevisionTracker()
    let heard = 0
    revisions.subscribe(() => {
      heard += 1
    })
    revisions.onResponse(new Response('{}', { status: 412 }), request(PAGE, 'PUT'))
    expect(revisions.hasConflict(KEY)).toBe(true)
    expect(heard).toBe(1)
    revisions.beginLoad(KEY)
    revisions.onResponse(read('"4.8"'), request(PAGE))
    revisions.endLoad(KEY)
    expect(revisions.hasConflict(KEY)).toBe(false)
    expect(heard).toBe(2)
  })
})

describe("an editor's own read", () => {
  // The fork's entity workspace calls this as it reads its entity (`onEntityLoad`).
  test("marks a document's read as the editor's own, until it ends, and nothing else's", () => {
    const revisions = createRevisionTracker()
    const loads = entityLoads(revisions)
    expect(loads('media', KEY)).toBeUndefined()
    revisions.onResponse(read('"5.8"'), request(PAGE))
    expect(revisions.revisionOf(KEY)).toBeUndefined()

    const done = loads('document', KEY.toUpperCase()) as () => void
    revisions.onResponse(read('"5.9"'), request(PAGE))
    done()
    expect(revisions.revisionOf(KEY)).toBe('"5.9"')
    // Once ended, another read of the page leaves it be.
    revisions.onResponse(read('"6.0"'), request(PAGE))
    expect(revisions.revisionOf(KEY)).toBe('"5.9"')
  })
})
