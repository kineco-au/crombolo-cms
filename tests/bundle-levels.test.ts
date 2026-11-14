/**
 * Story 324: what an install asks the person to accept, at a glance. Every
 * extension lands on one of three levels computed from its permissions; the
 * catalogue folds into four groups; an administrator grants the upper two, and
 * only for a package someone vouched for; and a host may keep Unrestricted to
 * the site's config. The same refusal answers the panel, the API and the CLI.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  BUNDLE_PERMISSIONS,
  createExtensionRegistry,
  groupsOf,
  LEVEL_WORDS,
  levelOf,
  readPermissions,
} from '@crombolo/backoffice-host'
import {
  ADMINISTRATOR_GRANTS,
  CONFIG_GRANTS,
  createBundleGrants,
  createKeyPair,
  grantRefusal,
  mayGrant,
  NOBODY_VOUCHED,
  signPathWithKey,
  switchOffUntrusted,
  unrestrictedFrom,
  vouchedFor,
} from '@crombolo/server'
import {
  configSnippet,
  grantChoice,
  groupLines,
  LEVELS,
  unvouchedLine,
  vouchState,
} from '../packages/backoffice-host/plugin/bundles-level-words.js'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

describe('the three levels', () => {
  test('are computed from the highest thing asked for, never declared', () => {
    expect(levelOf([])).toBe('limited')
    expect(levelOf(['content.read', 'http.outbound'])).toBe('limited')
    expect(levelOf(['user.delegate'])).toBe('acts-as-you')
    expect(levelOf(['user.delegate', 'backoffice.code'])).toBe('unrestricted')
    expect(levelOf(['backoffice.code', 'content.read'])).toBe('unrestricted')
  })

  test('the back office says them as the server does', () => {
    for (const [level, words] of Object.entries(LEVEL_WORDS))
      expect([
        level,
        LEVELS[level as keyof typeof LEVELS]?.label,
        LEVELS[level as keyof typeof LEVELS]?.sentence,
      ]).toEqual([level, words.label, words.sentence])
  })
})

describe('the four groups', () => {
  test('every permission in the catalogue lands in exactly one place', () => {
    for (const permission of Object.keys(BUNDLE_PERMISSIONS)) {
      const groups = groupsOf([
        permission === 'http.outbound'
          ? { permission, reason: 'x', origins: ['https://api.acme.com'] }
          : { permission, reason: 'x' },
      ])
      const places = Object.values(groups).filter((items) => items.length > 0).length
      // Acting for the person reads as what it sees, changes, and whom it acts as.
      expect([permission, places]).toEqual([permission, permission === 'user.delegate' ? 3 : 1])
    }
  })

  test('read and write apart, origins by host, and screens it adds', () => {
    expect(
      groupsOf(
        [
          { permission: 'content.read', reason: 'x' },
          { permission: 'redirects.write', reason: 'x' },
          { permission: 'http.outbound', reason: 'x', origins: ['https://api.acme.com'] },
          { permission: 'data.tables', reason: 'x' },
        ],
        { screens: 2 },
      ),
    ).toEqual({
      sees: ['pages'],
      changes: ['redirects'],
      sendsTo: ['api.acme.com'],
      adds: ['its own data', '2 screens'],
      actsAs: [],
    })
  })

  test('acting as you reads as everything you can see and change', () => {
    expect(groupsOf(['user.delegate'])).toMatchObject({
      sees: ['everything you can see'],
      changes: ['everything you can change'],
      actsAs: ['you, or whoever uses it'],
    })
  })

  test('the panel shows each group, Acts as only when asked for', () => {
    expect(groupLines({ sees: ['pages'], changes: [], sendsTo: [], adds: [], actsAs: [] })).toEqual(
      [
        { label: 'Sees', text: 'pages' },
        { label: 'Changes', text: 'nothing' },
        { label: 'Sends to', text: 'nothing' },
        { label: 'Adds', text: 'nothing' },
      ],
    )
  })
})

describe('never offered', () => {
  test('installing and granting extensions are refused by name, as writing users is', () => {
    for (const [permission, why] of [
      ['users.write', 'only an administrator changes users'],
      ['extensions.install', 'no extension brings in another'],
      ['extensions.grant', 'no extension widens what it, or another, was granted'],
    ]) {
      const read = readPermissions({ [permission as string]: 'x' })
      expect('problem' in read && read.problem).toBe(`"${permission}" is never offered: ${why}`)
    }
  })
})

describe('who may grant what', () => {
  // Signed by someone on this site's Trusted signers list (story 335).
  const signed = { state: 'signed' as const, trusted: true }
  const unsigned = { state: 'unsigned' as const }

  test('an administrator grants any level; one that asks for nothing needs no grant', () => {
    expect(
      grantRefusal({
        grants: true,
        level: 'limited',
        isAdmin: false,
        provenance: signed,
        from: 'backoffice',
      }),
    ).toBe(ADMINISTRATOR_GRANTS)
    expect(
      grantRefusal({
        grants: true,
        level: 'limited',
        isAdmin: true,
        provenance: unsigned,
        from: 'config',
      }),
    ).toBeUndefined()
    expect(
      grantRefusal({
        grants: false,
        level: 'limited',
        isAdmin: false,
        provenance: unsigned,
        from: 'backoffice',
      }),
    ).toBeUndefined()
  })

  test('the upper two need an administrator, and a package someone vouched for', () => {
    for (const level of ['acts-as-you', 'unrestricted'] as const) {
      expect(
        grantRefusal({
          grants: true,
          level,
          isAdmin: false,
          provenance: signed,
          from: 'backoffice',
        }),
      ).toBe(ADMINISTRATOR_GRANTS)
      expect(
        grantRefusal({
          grants: true,
          level,
          isAdmin: true,
          provenance: unsigned,
          from: 'backoffice',
        }),
      ).toBe(NOBODY_VOUCHED)
      expect(
        grantRefusal({
          grants: true,
          level,
          isAdmin: true,
          provenance: signed,
          from: 'backoffice',
        }),
      ).toBeUndefined()
    }
  })

  test('a local build, a trusted signature and one the host vouches for count; unsigned, invalid and unchecked do not', () => {
    expect(
      ['signed', 'vouched', 'local'].map((state) => vouchedFor({ state, trusted: true } as never)),
    ).toEqual([true, true, true])
    expect(
      ['unsigned', 'invalid', 'unchecked'].map((state) => vouchedFor({ state } as never)),
    ).toEqual([false, false, false])
    expect(vouchedFor(undefined)).toBe(false)
  })

  test('a signature from a signer this site does not trust vouches for nothing, and says who (story 335)', () => {
    const byKey = {
      state: 'signed' as const,
      trusted: false,
      key: { comment: 'anyone', fingerprint: 'SHA256:abc' } as never,
    }
    const byBuild = {
      state: 'signed' as const,
      trusted: false,
      source: { repository: 'someone/thing' } as never,
    }
    expect(vouchedFor(byKey)).toBe(false)
    expect(vouchedFor({ state: 'signed' })).toBe(false)
    for (const [provenance, who] of [
      [byKey, 'the key anyone (SHA256:abc)'],
      [byBuild, 'a build of github.com/someone/thing'],
    ] as const) {
      const why = grantRefusal({
        grants: true,
        level: 'unrestricted',
        isAdmin: true,
        provenance,
        from: 'backoffice',
      })
      expect(why).toContain(`It is signed by ${who}, which this site doesn't trust`)
      expect(why).toContain('Settings → Trusted signers')
    }
    // Limited is only labelled by a signature, trusted or not
    expect(
      grantRefusal({
        grants: true,
        level: 'limited',
        isAdmin: true,
        provenance: byKey,
        from: 'backoffice',
      }),
    ).toBeUndefined()
  })

  test('a host may keep Unrestricted to the config, for an administrator too', () => {
    expect(unrestrictedFrom('config')).toBe('config')
    expect(unrestrictedFrom(undefined)).toBe('backoffice')
    expect(unrestrictedFrom('anything')).toBe('backoffice')
    expect(
      grantRefusal({
        grants: true,
        level: 'unrestricted',
        isAdmin: true,
        provenance: signed,
        from: 'config',
      }),
    ).toBe(CONFIG_GRANTS)
    expect(
      grantRefusal({
        grants: true,
        level: 'acts-as-you',
        isAdmin: true,
        provenance: signed,
        from: 'config',
      }),
    ).toBeUndefined()
    expect(mayGrant(true, 'config')).toEqual({
      limited: 'yes',
      'acts-as-you': 'yes',
      unrestricted: 'config',
    })
    expect(mayGrant(false, 'backoffice')).toEqual({
      limited: 'administrator',
      'acts-as-you': 'administrator',
      unrestricted: 'administrator',
    })
  })

  test('the panel shows the button, the sentence, or the snippet', () => {
    const admin = mayGrant(true, 'backoffice')
    expect(grantChoice('limited', admin, 'unsigned')).toEqual({ grant: true })
    expect(grantChoice('limited', mayGrant(false, 'backoffice'), 'signed')).toEqual({
      sentence: 'An administrator can turn this on.',
    })
    expect(grantChoice('unrestricted', admin, 'signed')).toEqual({ grant: true })
    expect(grantChoice('unrestricted', admin, 'unsigned')).toEqual({
      sentence: "Nobody has vouched for who built this, so it can't be turned on here.",
    })
    expect(grantChoice('acts-as-you', mayGrant(false, 'backoffice'), 'signed')).toEqual({
      sentence: 'An administrator can turn this on.',
    })
    expect(grantChoice('unrestricted', mayGrant(true, 'config'), 'signed')).toEqual({
      snippet: true,
    })
    // Story 335: a signature counts only when its signer is trusted here
    expect(vouchState({ state: 'signed', trusted: true })).toBe('signed')
    expect(vouchState({ state: 'signed' })).toBe('untrusted')
    expect(vouchState({ state: 'local' })).toBe('local')
    expect(grantChoice('unrestricted', admin, vouchState({ state: 'signed' })).sentence).toContain(
      'Settings → Trusted signers',
    )
    expect(grantChoice('limited', admin, vouchState({ state: 'signed' }))).toEqual({ grant: true })
    expect(unvouchedLine('limited', 'unsigned')).toBe('Nobody has vouched for who built this')
    expect(unvouchedLine('limited', 'signed')).toBeUndefined()
    expect(
      configSnippet('seo', ['backoffice.code', 'http.outbound'], ['https://api.acme.com']),
    ).toBe(
      "extensions: {\n  'seo': { grant: ['backoffice.code', 'http.outbound'], origins: ['https://api.acme.com'] },\n},",
    )
  })
})

/**
 * A site with an Unrestricted extension waiting to be granted: linked, as one
 * built on this machine is, unless `range` says it came from the registry.
 */
async function unrestrictedSite(config: Record<string, unknown> = {}, range = 'link:@acme/seo') {
  const dir = siteDeclaring('bundle-levels', {
    '@acme/seo': {
      json: {
        crombolo: {
          id: 'acme-seo',
          permissions: { 'backoffice.code': 'Shows the SEO report' },
          extensions: [
            { type: 'dashboard', alias: 'Acme.Dashboard.Seo', name: 'SEO', element: 'dist/seo.js' },
          ],
        },
      },
      files: { 'dist/seo.js': 'export default class {}\n' },
    },
  })
  const manifest = join(dir, 'package.json')
  const json = await Bun.file(manifest).json()
  await Bun.write(manifest, JSON.stringify({ ...json, dependencies: { '@acme/seo': range } }))
  const h = await signedInServer({
    config: { siteDir: dir, componentsDir: join(dir, 'components'), ...config },
  })
  open.push(h)
  return h
}

/** Where the test extension is installed: in a root of its own. */
const seoDirectory = (siteDir: string) =>
  (
    createExtensionRegistry(siteDir, { cache: false })
      .bundles()
      .bundles.find((pkg) => pkg.id === 'acme-seo') as { directory: string }
  ).directory

const grant = (h: Harness) =>
  h.post(`${BACKOFFICE}/crombolo/api/bundles/grant`, { id: 'acme-seo', grant: ['backoffice.code'] })

describe('on a real server', () => {
  test('Installed shows each row’s level and groups, and what this person may grant', async () => {
    const h = await unrestrictedSite()
    const installed = await h.json<{
      items: { id: string; level: string; groups: { adds: string[] }; status: string }[]
      mayGrant: object
    }>(`${BACKOFFICE}/crombolo/api/extensions/installed`)
    const row = installed.items.find((item) => item.id === 'acme-seo')
    expect(row).toMatchObject({
      level: 'unrestricted',
      groups: { adds: ['its own code in your back office'] },
      status: 'not-granted',
    })
    expect(installed.mayGrant).toEqual({
      limited: 'yes',
      'acts-as-you': 'yes',
      unrestricted: 'yes',
    })
  })

  test('someone with Settings who is not an administrator is refused a grant, saying who may', async () => {
    const h = await unrestrictedSite()
    const created = await h.post(`${V1}/user-group`, {
      name: 'Builders',
      alias: 'builders',
      sections: ['Umb.Section.Content', 'Umb.Section.Settings'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: true,
      documentStartNode: null,
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: ['Umb.Document.Read'],
      permissions: [],
    })
    expect(created.status).toBe(201)
    const builder = await signInAsGroup(h, 'builders')
    const refused = await grant(builder)
    expect(refused.status).toBe(403)
    expect((await refused.json()).message).toContain(ADMINISTRATOR_GRANTS)
    // Installing and removing are an administrator's too, whatever it asks for.
    for (const action of ['install', 'uninstall']) {
      const answer = await builder.post(`${BACKOFFICE}/crombolo/api/extensions/${action}`, {
        name: '@acme/seo',
      })
      expect([action, answer.status, (await answer.json()).message]).toEqual([
        action,
        403,
        'An administrator installs and removes extensions.',
      ])
    }
  })

  test('an administrator is refused one nobody vouched for', async () => {
    const h = await unrestrictedSite({}, '*')
    const refused = await grant(h)
    expect(refused.status).toBe(403)
    expect((await refused.json()).message).toContain(NOBODY_VOUCHED)
  })

  test('an administrator grants an Unrestricted extension built here, and the audit names the level', async () => {
    const h = await unrestrictedSite()
    const granted = await grant(h)
    expect(granted.status, await granted.clone().text()).toBe(200)
    const log = await h.json<{ items: { action: string; detail: string | null }[] }>(
      `${BACKOFFICE}/crombolo/api/audit?take=20`,
    )
    expect(log.items.find((item) => item.action === 'Grant')?.detail).toBe(
      'granted Unrestricted: backoffice.code',
    )
  })

  test('a key vouches only when this site trusts it (story 335)', async () => {
    const pair = createKeyPair('anyone')
    const signedSite = async (config: Record<string, unknown> = {}) => {
      const h = await unrestrictedSite(config, '*')
      await signPathWithKey(seoDirectory(h.server.config.siteDir), pair)
      return h
    }
    const untrusted = await signedSite()
    const refused = await grant(untrusted)
    expect(refused.status).toBe(403)
    const message = (await refused.json()).message as string
    expect(message).toContain(`the key anyone (${pair.publicKey.fingerprint})`)
    expect(message).toContain('Settings → Trusted signers')
    const row = (
      await untrusted.json<{ items: { id: string; provenance: { trusted?: boolean } }[] }>(
        `${BACKOFFICE}/crombolo/api/extensions/installed`,
      )
    ).items.find((item) => item.id === 'acme-seo')
    expect(row?.provenance.trusted).toBe(false)

    const trusting = await signedSite({
      trustedKeys: [{ name: 'Release', publicKey: pair.publicKey.line }],
    })
    const granted = await grant(trusting)
    expect(granted.status, await granted.clone().text()).toBe(200)
  })

  test('at start, an upper-level grant nobody trusted vouches for is withdrawn (story 335)', async () => {
    const pair = createKeyPair('anyone')
    const h = await unrestrictedSite(
      { trustedKeys: [{ name: 'Release', publicKey: pair.publicKey.line }] },
      '*',
    )
    const dir = h.server.config.siteDir
    await signPathWithKey(seoDirectory(dir), pair)
    expect((await grant(h)).status).toBe(200)

    // The key is no longer trusted: the next start withdraws the grant
    const config = { ...h.server.config, trustedKeys: [] }
    const extensions = createExtensionRegistry(dir, { cache: false })
    const grants = createBundleGrants({
      db: h.server.db,
      packages: () => new Map(extensions.bundles().bundles.map((pkg) => [pkg.id, pkg])),
    })
    await grants.refresh()
    expect(grants.isOn('acme-seo')).toBe(true)
    expect(await switchOffUntrusted(h.server.db, config, extensions, grants)).toEqual(['acme-seo'])
    expect(grants.isOn('acme-seo')).toBe(false)
    // Trusted again, nothing is withdrawn
    await grants.refresh()
    expect(await switchOffUntrusted(h.server.db, h.server.config, extensions, grants)).toEqual([])
    const log = await h.json<{ items: { action: string; detail: string | null }[] }>(
      `${BACKOFFICE}/crombolo/api/audit?take=20`,
    )
    expect(
      log.items.find((item) => item.detail?.startsWith('switched off at start'))?.detail,
    ).toContain("which this site doesn't trust")
  })

  test('a signer taken off the list switches off what it vouched for at once, not at the next start (story 335)', async () => {
    const pair = createKeyPair('release')
    const h = await unrestrictedSite({}, '*')
    await signPathWithKey(seoDirectory(h.server.config.siteDir), pair)
    const signers = `${BACKOFFICE}/crombolo/api/bundles/signers`
    const added = (await (
      await h.post(signers, { kind: 'user', name: 'Release', publicKey: pair.publicKey.line })
    ).json()) as { entry: { id: string } }

    const granted = await grant(h)
    expect(granted.status, await granted.clone().text()).toBe(200)

    const removed = (await (
      await h.call(`${signers}/${added.entry.id}`, { method: 'DELETE' })
    ).json()) as { ok: boolean; switchedOff: string[] }
    expect(removed).toMatchObject({ ok: true, switchedOff: [expect.stringMatching(/seo/i)] })
    expect(h.server.bundleGrants.isOn('acme-seo')).toBe(false)
    const log = await h.json<{ items: { action: string; detail: string | null }[] }>(
      `${BACKOFFICE}/crombolo/api/audit?take=20`,
    )
    expect(
      log.items.find((item) => item.detail?.includes('taken off Trusted signers'))?.detail,
    ).toContain('switched off as its signer was taken off Trusted signers')
  })

  test('a host that keeps Unrestricted to the config refuses the back office, and the config still grants', async () => {
    const locked = await unrestrictedSite({ unrestrictedExtensions: 'config' })
    const refused = await grant(locked)
    expect(refused.status).toBe(403)
    expect((await refused.json()).message).toContain(CONFIG_GRANTS)
    expect(
      (await locked.json<{ mayGrant: object }>(`${BACKOFFICE}/crombolo/api/extensions/installed`))
        .mayGrant,
    ).toEqual({ limited: 'yes', 'acts-as-you': 'yes', unrestricted: 'config' })

    const configured = await unrestrictedSite({
      unrestrictedExtensions: 'config',
      extensions: { 'acme-seo': { grant: ['backoffice.code'] } },
    })
    const installed = await configured.json<{ items: { id: string; status: string }[] }>(
      `${BACKOFFICE}/crombolo/api/extensions/installed`,
    )
    expect(installed.items.find((item) => item.id === 'acme-seo')?.status).toBe('on')
  })
})
