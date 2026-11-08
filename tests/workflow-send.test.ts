/**
 * Story 028: the bottom bar offers "Send for approval" and "Request unpublish"
 * only while the page's workflow lets the reader send it, and sends the times given.
 */
import { describe, expect, test } from 'bun:test'
import { maySend, scheduleFor } from '../packages/backoffice-host/plugin/workflow-send-model.js'

const covered = (can: Record<string, boolean>, request: unknown = null) => ({
  ok: true,
  workflow: { alias: 'review' },
  request,
  can,
})

describe('what the bottom bar offers', () => {
  test('sending, and asking to take it down, as the workflow lets this reader', () => {
    expect(maySend(covered({ send: true, requestUnpublish: false }), 'publish')).toBe(true)
    expect(maySend(covered({ send: true, requestUnpublish: false }), 'unpublish')).toBe(false)
    expect(maySend(covered({ send: false, requestUnpublish: true }), 'unpublish')).toBe(true)
  })

  test('nothing while a request is open, with no workflow, or when the page cannot be read', () => {
    expect(maySend(covered({ send: true }, { key: 'r' }), 'publish')).toBe(false)
    expect(
      maySend({ ok: true, workflow: null, request: null, can: { send: true } }, 'publish'),
    ).toBe(false)
    expect(maySend({ ok: false }, 'publish')).toBe(false)
    expect(maySend(undefined, 'publish')).toBe(false)
  })
})

describe('the times a request carries', () => {
  test('none when none are given', () => {
    expect(scheduleFor('publish', '', '')).toBeUndefined()
  })

  test('a take-down time only, when asking to take it down', () => {
    const [unpublish] = scheduleFor('unpublish', '2030-01-01T09:00', '2030-02-01T09:00') ?? []
    expect(unpublish?.publishTime).toBeNull()
    expect(unpublish?.unpublishTime).toBeTruthy()
  })

  test('both, for the whole page, when sending to publish', () => {
    const [both] = scheduleFor('publish', '2030-01-01T09:00', '2030-02-01T09:00') ?? []
    expect(both?.culture).toBeNull()
    expect(both?.publishTime).toBeTruthy()
    expect(both?.unpublishTime).toBeTruthy()
  })
})
