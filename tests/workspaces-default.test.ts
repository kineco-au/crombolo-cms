/**
 * Story 420: workspaces are on unless turned off. `CROMBOLO_WORKSPACES` is `true`
 * unless set; `false` turns them off; anything else stops the site starting. A locked
 * site has them whatever it says. `crombolo status` and the overview say which.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { loadConfig, siteStatus, workspacesOn } from '@crombolo/server'
import { workspacesSettingOf } from '../packages/backoffice-host/plugin/overview-format.js'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const env = Bun.env as Record<string, string | undefined>
const withSetting = <T>(value: string | undefined, fn: () => T): T => {
  const before = env.CROMBOLO_WORKSPACES
  try {
    if (value === undefined) delete env.CROMBOLO_WORKSPACES
    else env.CROMBOLO_WORKSPACES = value
    return fn()
  } finally {
    if (before === undefined) delete env.CROMBOLO_WORKSPACES
    else env.CROMBOLO_WORKSPACES = before
  }
}

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

describe('the switch', () => {
  test('is on with nothing set, off only when set to false, and refuses anything else', () => {
    expect(withSetting(undefined, () => loadConfig({}).workspaces)).toBe(true)
    expect(withSetting('true', () => loadConfig({}).workspaces)).toBe(true)
    expect(withSetting('FALSE', () => loadConfig({}).workspaces)).toBe(false)
    expect(() => withSetting('sometimes', () => loadConfig({}))).toThrow('it is true or false')
  })

  test('a locked site has them, whatever it says; required stays off unless set', () => {
    const locked = withSetting('false', () => loadConfig({ contentEditing: 'locked' }))
    expect(workspacesOn(locked)).toBe(true)
    expect(withSetting(undefined, () => loadConfig({}).workspacesRequired)).toBe(false)
  })

  test('the overview says which', () => {
    expect(workspacesSettingOf({ enabled: true, required: false })).toBe('On')
    expect(workspacesSettingOf({ enabled: true, required: true })).toBe('On, every edit in one')
    expect(workspacesSettingOf({ enabled: false })).toBe('Off')
  })
})

describe('a site with nothing set', () => {
  test('opens workspaces, and status says they are on', async () => {
    const h = await signedInServer()
    open.push(h)
    expect(h.server.config.workspaces).toBe(true)
    const mine = await h.json<{ enabled: boolean }>(`${BACKOFFICE}/crombolo/api/workspaces/mine`)
    expect(mine.enabled).toBe(true)
    const status = await siteStatus(h.server.config)
    expect(status.site.workspaces).toEqual({ on: true, required: false })
  })

  test('turned off, every workspace route is refused, and status says so', async () => {
    const h = await signedInServer({ config: { workspaces: false } })
    open.push(h)
    const mine = await h.json<{ enabled: boolean }>(`${BACKOFFICE}/crombolo/api/workspaces/mine`)
    expect(mine.enabled).toBe(false)
    const listed = await h.call(`${BACKOFFICE}/crombolo/api/workspaces`)
    expect(listed.status).toBeGreaterThanOrEqual(400)
    expect((await siteStatus(h.server.config)).site.workspaces.on).toBe(false)
  })
})
