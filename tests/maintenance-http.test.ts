/**
 * Story 409: editing paused over HTTP, for a set time or until resumed. A pause past its
 * end is no pause, by the reading node's own clock; the routes pause and resume for a
 * caller who may apply changes (Apply changes), audited; pausing again for the same
 * reason moves the end; and the back office shows editors a banner while it lasts.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { RemotePermissions } from '@crombolo/core'
import {
  assertNodeMayWrite,
  currentSchemaState,
  type Db,
  parseWritesPaused,
  pauseEnded,
  pauseWrites,
  readWritesPaused,
  WritesPausedError,
} from '@crombolo/data'
import {
  backAt,
  msUntilBack,
  pausedLabel,
} from '../packages/backoffice-host/plugin/maintenance-words.js'
import { parseDuration } from '../packages/cli/src/operations/commands.ts'
import { pauseRequest } from '../packages/server/src/maintenance-api.ts'
import { dialectUnderTest, migratedDb } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
} from './support/harness.ts'

const ROUTE = `${BACKOFFICE}/crombolo/api/maintenance`
const NOW = new Date('2026-11-24T10:00:00Z')

const dbs: Db[] = []
const open: Harness[] = []
afterEach(async () => {
  while (dbs.length > 0)
    await dbs
      .pop()
      ?.close()
      .catch(() => {})
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('a pause with an end', () => {
  test('is no pause once its end has passed; one stored before has none', () => {
    const stored = (until: string | null) =>
      JSON.stringify({ reason: 'deploy', by: 'host', at: NOW.toISOString(), until })
    const later = new Date(NOW.getTime() + 60_000).toISOString()
    expect(parseWritesPaused(stored(later), NOW)).toMatchObject({ until: later })
    expect(parseWritesPaused(stored(later), new Date(NOW.getTime() + 60_000))).toBeUndefined()
    expect(parseWritesPaused('{"reason":"old","by":null,"at":"x"}', NOW)).toMatchObject({
      reason: 'old',
      until: null,
    })
    expect(pauseEnded({ until: null }, NOW)).toBe(false)
  })

  test('a request says forSeconds or until, never both, and not in the past', () => {
    expect(pauseRequest({ action: 'resume' }, NOW)).toEqual({ action: 'resume' })
    expect(pauseRequest({ action: 'pause', reason: ' deploy ' }, NOW)).toEqual({
      action: 'pause',
      reason: 'deploy',
      until: null,
    })
    expect(pauseRequest({ action: 'pause', forSeconds: 90 }, NOW)).toMatchObject({
      until: new Date('2026-11-24T10:01:30Z'),
    })
    expect(pauseRequest({ action: 'pause', until: '2026-11-24T11:00:00Z' }, NOW)).toMatchObject({
      until: new Date('2026-11-24T11:00:00Z'),
    })
    for (const body of [
      { action: 'pause', forSeconds: 0 },
      { action: 'pause', forSeconds: 'soon' },
      { action: 'pause', until: '2026-11-24T10:00:00.500Z' },
      { action: 'pause', until: 'tomorrow' },
      { action: 'pause', forSeconds: 60, until: '2026-11-24T11:00:00Z' },
      { action: 'stop' },
    ])
      expect('refused' in pauseRequest(body, NOW), JSON.stringify(body)).toBe(true)
  })

  test('the command line reads a length as people write it', () => {
    expect(parseDuration('90s')).toBe(90_000)
    expect(parseDuration('10m')).toBe(600_000)
    expect(parseDuration('1h30m')).toBe(5_400_000)
    for (const bad of ['', '10', 'ten minutes', '0s', '5x'])
      expect(parseDuration(bad)).toBeUndefined()
  })

  test('the banner says why, and when saving is back, in the person’s own time', () => {
    const today = new Date(2026, 10, 24, 9, 0)
    const at = new Date(2026, 10, 24, 10, 10).toISOString()
    expect(pausedLabel({ reason: 'Deploying', until: at }, today, 'en-GB')).toBe(
      'Editing is paused for maintenance: Deploying. You can save again at 10:10.',
    )
    expect(pausedLabel({ reason: null, until: null }, today, 'en-GB')).toBe(
      'Editing is paused for maintenance. You can save again once it is resumed.',
    )
    expect(backAt(new Date(2026, 10, 25, 10, 10).toISOString(), today, 'en-GB')).toBe(
      'Wed 25 Nov, 10:10',
    )
    expect(msUntilBack({ until: at }, today)).toBe(70 * 60_000)
    expect(msUntilBack({ until: null }, today)).toBeNull()
  })
})

describe(`the write gate and a pause's end (${dialectUnderTest})`, () => {
  test('refuses a save until the end passes, then lets it through with nothing resumed', async () => {
    const db = await migratedDb()
    dbs.push(db)
    const current = await currentSchemaState(db)
    const node = { version: current.version, revision: current.revision }
    await pauseWrites(db, { reason: 'deploy', until: new Date(Date.now() + 1200) })
    expect(await assertNodeMayWrite(db, node).catch((e: unknown) => e)).toBeInstanceOf(
      WritesPausedError,
    )
    await sleep(1400)
    await expect(assertNodeMayWrite(db, node)).resolves.toMatchObject({ id: current.id })
    expect(await readWritesPaused(db)).toBeUndefined()
  })

  test('pausing again for the same reason keeps who and when, and moves the end', async () => {
    const db = await migratedDb()
    dbs.push(db)
    const first = await pauseWrites(db, {
      reason: 'deploy',
      by: 'host',
      until: new Date(Date.now() + 60_000),
    })
    const again = await pauseWrites(db, {
      reason: 'deploy',
      by: 'someone else',
      until: new Date(Date.now() + 120_000),
    })
    expect(again).toMatchObject({ by: 'host', at: first.at })
    expect(again.until).not.toBe(first.until)
    const other = await pauseWrites(db, { reason: 'restore', by: 'operator' })
    expect(other).toMatchObject({ reason: 'restore', by: 'operator', until: null })
  })
})

describe(`pausing editing over HTTP (${dialectUnderTest})`, () => {
  const tokenOf = (h: Harness) => /umbAccessToken[^=]*=([^;]+)/.exec(h.cookie())?.[1] as string
  const post = (h: Harness, body: unknown, bearer?: string) =>
    bearer
      ? h.server.fetch(
          new Request(`${ORIGIN}${ROUTE}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        )
      : h.call(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })

  test('an administrator pauses for a time, every reader is told, and it is audited', async () => {
    const h = await signedInServer()
    open.push(h)
    const paused = await post(h, { action: 'pause', reason: 'Deploying', forSeconds: 600 })
    expect(paused.status, await paused.clone().text()).toBe(200)
    const body = (await paused.json()) as { paused: { until: string; by: string } }
    expect(new Date(body.paused.until).getTime()).toBeGreaterThan(Date.now() + 590_000)
    expect(body.paused.by).toEqual(expect.any(String))

    // An editor reads what the banner needs, not who paused it.
    const writer = await signInAsGroup(h, 'writer')
    expect(await writer.json<unknown>(ROUTE)).toEqual({
      paused: { reason: 'Deploying', until: body.paused.until },
    })
    // `/health` is the node's own view, as of its last poll.
    await h.server.poll()
    const health = (await (await h.server.fetch(new Request(`${ORIGIN}/health`))).json()) as {
      paused: { until: string }
    }
    expect(health.paused.until).toBe(body.paused.until)

    expect((await post(writer, { action: 'pause' })).status).toBe(403)
    expect((await post(writer, { action: 'resume' }, tokenOf(writer))).status).toBe(403)
    expect(
      (await h.server.fetch(new Request(`${ORIGIN}${ROUTE}`, { method: 'POST' }))).status,
    ).toBe(401)

    expect(await (await post(h, { action: 'resume' })).json()).toEqual({ paused: null })
    expect(await (await post(h, { action: 'resume' })).json()).toEqual({ paused: null })
    const audited = await h.server.db.q
      .selectFrom('audit_entry')
      .select(['action', 'detail'])
      .where('action', 'in', ['PauseEditing', 'ResumeEditing'])
      .execute()
    expect(audited.map((a) => a.action).sort()).toEqual(['PauseEditing', 'ResumeEditing'])
    expect(audited.find((a) => a.action === 'PauseEditing')?.detail).toContain('Deploying')
  }, 30_000)

  test('a caller who may apply changes pauses, by token or cookie; a bad end is refused', async () => {
    const h = await signedInServer()
    open.push(h)
    const writers = await h.server.db.q
      .selectFrom('user_group')
      .select('key')
      .where('alias', '=', 'writer')
      .executeTakeFirst()
    await h.server.db.q
      .insertInto('user_group_permission')
      .values({
        user_group_key: String(writers?.key),
        permission: RemotePermissions.ApplyChanges,
      })
      .execute()
    const writer = await signInAsGroup(h, 'writer')
    const token = tokenOf(writer)
    expect((await post(writer, { action: 'pause' }, token)).status).toBe(200)
    expect(
      (
        await post(
          writer,
          { action: 'pause', until: new Date(Date.now() - 1000).toISOString() },
          token,
        )
      ).status,
    ).toBe(400)
    expect((await post(writer, { action: 'resume' }, token)).status).toBe(200)
    expect((await post(writer, { action: 'pause', forSeconds: 60 })).status).toBe(200)
    expect((await post(writer, { action: 'resume' })).status).toBe(200)
  }, 30_000)
})
