/**
 * Story 310: an installed, granted extension runs with nothing imported by the
 * site. The config's `extensions` names what it grants and sets values that
 * lock; the back office sets the rest.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BundlePackage } from '@crombolo/backoffice-host'
import { entryCovers, extensionEntryProblems, sealSecret, settingsOf } from '@crombolo/server'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const KEY = 'a-secret-key-that-is-long-enough-to-use-0123'

const crm = (
  permissions: Record<string, unknown>,
  settings?: Record<string, unknown>,
): BundlePackage =>
  stubBundlePackage('crm', {
    field: {
      bundleType: 'extension',
      id: 'crm',
      server: 'crm',
      schemaVersion: 4,
      permissions: permissions as never,
      ...(settings ? { settings } : {}),
    },
  })

describe('what the config grants', () => {
  test('all a version asks for, or nothing', () => {
    const pkg = crm({ 'content.read': 'x', 'members.read': 'x' })
    expect(entryCovers(pkg, { grant: ['content.read', 'members.read'] })).toBe(true)
    expect(entryCovers(pkg, { grant: ['content.read'] })).toBe(false)
    expect(entryCovers(pkg, undefined)).toBe(false)
    const reaching = crm({ 'http.outbound': { reason: 'x', origins: ['https://api.acme.com'] } })
    expect(entryCovers(reaching, { grant: ['http.outbound'] })).toBe(false)
    expect(
      entryCovers(reaching, { grant: ['http.outbound'], origins: ['https://api.acme.com'] }),
    ).toBe(true)
  })

  test('an entry for an extension the site has not got is a boot problem', () => {
    expect(extensionEntryProblems({ ghost: { grant: [] } }, [crm({})])).toEqual([
      expect.stringContaining('names "ghost"'),
    ])
  })
})

describe('settings', () => {
  test('defaults, then the back office, then the config, which wins; a secret opened', () => {
    const pkg = crm(
      {},
      {
        section: {
          label: 'Section',
          type: 'choice',
          values: ['settings', 'content'],
          default: 'settings',
        },
        token: { label: 'Token', type: 'text', secret: true },
        limit: { label: 'Limit', type: 'number', default: 10 },
      },
    )
    expect(
      settingsOf(
        pkg,
        { section: 'content', token: { sealed: sealSecret('s3cret', KEY) }, limit: 20 },
        { settings: { limit: 5 } },
        KEY,
      ),
    ).toEqual({ section: 'content', token: 's3cret', limit: 5 })
    expect(settingsOf(pkg, undefined, undefined)).toEqual({ section: 'settings', limit: 10 })
  })
})

/** A site with @acme/crm installed: a server half whose back-office route answers its settings. */
function crmSite() {
  return siteDeclaring('extension-discovery', {
    '@acme/crm': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'crm',
          name: 'CRM',
          server: 'crm',
          schemaVersion: 4,
          permissions: { 'content.read': 'Shows pages' },
          settings: {
            greeting: { label: 'Greeting', type: 'text', default: 'hello' },
            loud: { label: 'Loud', type: 'boolean', default: false },
          },
        },
      },
      files: {
        'index.js': `import { route } from '@crombolo/common'
export function crm(settings) {
  return {
    id: 'crm',
    section: 'settings',
    capabilities: ['api'],
    routes: [route('settings', { GET: () => Response.json(settings) }, { audience: 'backoffice' })],
  }
}
`,
      },
    },
  })
}

const settingsOfRoute = (h: Harness) => h.call(`${BACKOFFICE}/crombolo/api/bundle/crm/settings`)

describe('an installed extension', () => {
  test('runs from the config’s grant, with its settings, and nothing imported', async () => {
    const dir = crmSite()
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { crm: { grant: ['content.read'], settings: { greeting: 'hi' } } },
      },
    })
    open.push(h)
    const answered = await settingsOfRoute(h)
    expect(answered.status, await answered.clone().text()).toBe(200)
    expect(await answered.json()).toEqual({ greeting: 'hi', loud: false })
    const listed = (await (
      await h.call(`${BACKOFFICE}/crombolo/api/bundles/installed`)
    ).json()) as {
      items: Array<{
        id: string
        granted?: { by: string }
        settings: Array<{ key: string; locked: boolean }>
      }>
    }
    const item = listed.items.find((candidate) => candidate.id === 'crm')
    expect(item?.granted?.by).toBe("the site's code")
    expect(item?.settings.find((s) => s.key === 'greeting')?.locked).toBe(true)
    expect(item?.settings.find((s) => s.key === 'loud')?.locked).toBe(false)

    // A setting the config locks is refused; another is kept, for the next start.
    const locked = await h.post(`${BACKOFFICE}/crombolo/api/bundles/settings`, {
      id: 'crm',
      values: { greeting: 'yo' },
    })
    expect(locked.status).toBe(400)
    const saved = await h.post(`${BACKOFFICE}/crombolo/api/bundles/settings`, {
      id: 'crm',
      values: { loud: true },
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect(((await saved.json()) as { message: string }).message).toContain(
      'when the site restarts',
    )
  })

  test('is not started when nothing grants it, nor when the config grants too little', async () => {
    for (const extensions of [undefined, { crm: { grant: [] } }]) {
      const dir = crmSite()
      const h = await signedInServer({
        config: {
          siteDir: dir,
          componentsDir: join(dir, 'components'),
          ...(extensions ? { extensions } : {}),
        },
      })
      open.push(h)
      expect((await settingsOfRoute(h)).status).toBe(404)
    }
  })

  test('an entry for an extension the site has not got stops the boot, naming it', async () => {
    const dir = crmSite()
    await expect(
      signedInServer({
        config: {
          siteDir: dir,
          componentsDir: join(dir, 'components'),
          extensions: { ghost: { grant: [] } },
        },
      }),
    ).rejects.toThrow('names "ghost"')
  })
})
