/**
 * Story 360: the site-wide search and sharing settings without the server —
 * `readSeoSettings` and `saveSeoSettings`, which the screen's routes and the
 * command line share: where each value comes from, a `null` removing a saved
 * one, and a malformed change refused.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { type Db, readKeyValue } from '@crombolo/data'
import {
  type CromboloConfig,
  DEFAULT_ROBOTS_TXT,
  readSeoSettings,
  SEO_SETTINGS_KEY,
  saveSeoSettings,
} from '@crombolo/server'
import { migratedDb } from './support/db.ts'

const dbs: Db[] = []
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()?.close()
})

const open = async () => {
  const db = await migratedDb()
  dbs.push(db)
  return db
}

const PAGE = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const config = (seo: CromboloConfig['seo'] = {}): Pick<CromboloConfig, 'siteName' | 'seo'> => ({
  siteName: 'Acme',
  seo,
})

describe('readSeoSettings', () => {
  test('each value is the default when neither configured nor saved', async () => {
    const db = await open()
    const read = await readSeoSettings(db, config())
    expect(read.effective).toEqual({
      sitemap: true,
      indexable: true,
      robotsTxt: DEFAULT_ROBOTS_TXT,
      siteName: 'Acme',
      titleSuffix: '',
      defaultImage: '',
      notFoundPage: [],
    })
    expect(Object.values(read.sources).every((s) => s === 'default')).toBe(true)
    expect(read.overrides).toEqual({})
  })

  test('a configured value, then a saved one over it', async () => {
    const db = await open()
    const configured = config({ titleSuffix: ' | Config', notFoundPage: PAGE, indexable: false })
    const read = await readSeoSettings(db, configured)
    expect(read.effective).toMatchObject({
      titleSuffix: ' | Config',
      indexable: false,
      notFoundPage: [{ document: PAGE }],
    })
    expect(read.sources).toMatchObject({
      titleSuffix: 'config',
      indexable: 'config',
      notFoundPage: 'config',
      siteName: 'default',
    })

    const saved = await saveSeoSettings(db, configured, { titleSuffix: ' | Saved' })
    expect(saved.ok).toBe(true)
    const again = await readSeoSettings(db, configured)
    expect(again.effective.titleSuffix).toBe(' | Saved')
    expect(again.sources.titleSuffix).toBe('backoffice')
    expect(again.overrides).toEqual({ titleSuffix: ' | Saved' })
    expect(again.sources.indexable).toBe('config')
  })
})

describe('saveSeoSettings', () => {
  test('merges into what is saved, and answers the settings as they now stand', async () => {
    const db = await open()
    await saveSeoSettings(db, config(), { siteName: 'Saved name', robotsTxt: 'User-agent: *' })
    const saved = await saveSeoSettings(db, config(), { sitemap: false })
    if (!saved.ok) throw new Error(saved.message)
    expect(saved.settings.overrides).toEqual({
      siteName: 'Saved name',
      robotsTxt: 'User-agent: *',
      sitemap: false,
    })
    expect(saved.settings.sources).toMatchObject({
      siteName: 'backoffice',
      robotsTxt: 'backoffice',
      sitemap: 'backoffice',
      indexable: 'default',
    })
    expect(JSON.parse((await readKeyValue(db, SEO_SETTINGS_KEY)) ?? '{}')).toEqual(
      saved.settings.overrides,
    )
  })

  test('a null removes a saved value, so the configuration applies again', async () => {
    const db = await open()
    const configured = config({ siteName: 'Configured' })
    await saveSeoSettings(db, configured, { siteName: 'Saved', titleSuffix: ' | Acme' })
    const cleared = await saveSeoSettings(db, configured, { siteName: null })
    if (!cleared.ok) throw new Error(cleared.message)
    expect(cleared.settings.effective.siteName).toBe('Configured')
    expect(cleared.settings.sources.siteName).toBe('config')
    expect(cleared.settings.overrides).toEqual({ titleSuffix: ' | Acme' })
    expect((await readSeoSettings(db, configured)).overrides).toEqual({ titleSuffix: ' | Acme' })
  })

  test('a malformed value is refused, and nothing is saved', async () => {
    const db = await open()
    await saveSeoSettings(db, config(), { titleSuffix: ' | Acme' })
    for (const [changes, message] of [
      [{ indexable: 'yes' }, 'indexable must be true or false.'],
      [{ siteName: 4 }, 'siteName must be text.'],
      [{ notFoundPage: 'not a key' }, 'Choose a page for each not-found rule.'],
      [[], 'Expected an object of settings.'],
    ] as const) {
      const refused = await saveSeoSettings(db, config(), changes)
      expect(refused).toEqual({ ok: false, message })
    }
    expect((await readSeoSettings(db, config())).overrides).toEqual({ titleSuffix: ' | Acme' })
  })
})
