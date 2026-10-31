/**
 * Story 232: the Plain Signal demo, booted from `sites/plain-signal` with its
 * seed. Its front page, an article with its image and credit, the contact page
 * whose form is an island, the newsroom's groups from `schema/user-groups/`
 * and the two-stage workflow that covers its articles.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { UserGroupRepository } from '@crombolo/data'
import { compileSeed, installBundleContent, seedKey } from '@crombolo/server'
import { writeSeedPackage } from '../packages/cli/src/support/seed.ts'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const SITE = join(import.meta.dir, '..', 'sites', 'plain-signal')
const API = '/umbraco/delivery/api/v2'

let h: Harness
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'plain-signal-'))
  for (const part of ['schema', 'components', 'css', 'seed', 'package.json'])
    cpSync(join(SITE, part), join(root, part), { recursive: true })
  h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      stylesheetsDir: join(root, 'css'),
      mediaDir: join(root, 'media'),
      deliveryApi: { enabled: true },
    },
  })
  const build = await compileSeed(h.server.db, h.server.config)
  expect(build.findings).toEqual([])
  const dir = join(root, 'seed-package')
  writeSeedPackage(build, dir)
  await installBundleContent(h.server.db, h.server.config, {
    bundle: dir,
    withoutSchema: true,
    withoutFiles: true,
    backupTaken: true,
    publish: true,
  })
  h.server.cache.invalidate()
  await h.server.cache.fresh()
}, 120_000)

afterAll(async () => {
  await h?.db.close().catch(() => {})
  if (root) rmSync(root, { recursive: true, force: true })
})

const page = async (path: string) => {
  const response = await h.server.fetch(new Request(`${ORIGIN}${path}`))
  return { status: response.status, html: await response.text() }
}

describe('Plain Signal', () => {
  test('its front page leads with the newest article and lists every one, by section', async () => {
    const { status, html } = await page('/')
    expect(status).toBe(200)
    expect(html).toContain('AI news with the noise taken out.')
    for (const section of ['Health', 'Planet', 'Discovery', 'Contact'])
      expect(html).toContain(`>${section}</a>`)
    expect(html).not.toContain('>Site Settings<')
    const lead = html.indexOf('card--lead')
    expect(html.indexOf('A second pair of eyes on every mammogram')).toBeGreaterThan(lead)
    for (const headline of [
      'The forecast that learned from forty years of weather',
      'The implant that gave Casey Harrell his voice back',
      'Antibiotics designed from scratch',
      'A machine that writes proofs',
      'The Nobel Prize for predicting proteins',
    ])
      expect(html).toContain(headline)
    expect(html).toContain('Plain Signal is a demonstration site')
  })

  test('an article shows its image with its caption and credit, why it matters, and its sources', async () => {
    const { status, html } = await page(
      '/planet/the-forecast-that-learned-from-forty-years-of-weather',
    )
    expect(status).toBe(200)
    expect(html).toMatch(
      /<img src="\/media\/[0-9a-f]{8}\/hurricane-florence-from-the-iss\.jpg\?width=1400/,
    )
    expect(html).toContain('NASA, public domain.')
    expect(html).toContain('Why it matters')
    expect(html).toContain('https://doi.org/10.1038/s41586-024-08252-9')
    expect(html).toContain('97.2%')
  })

  test('the contact page draws its form as an island, with the server form as its fallback', async () => {
    const { status, html } = await page('/contact')
    expect(status).toBe(200)
    expect(html).toContain('<crombolo-island')
    expect(html).toContain('&quot;alias&quot;:&quot;writeToTheDesk&quot;'.replaceAll('&quot;', '"'))
    expect(html).toContain('Send to the desk')
    // Its browser code was built with the views it rendered with.
    const manifestUrl = /<meta name="crombolo-islands" content="([^"]+)"/.exec(html)?.[1] as string
    const manifest = (await (
      await h.server.fetch(new Request(`${ORIGIN}${manifestUrl}`))
    ).json()) as {
      modules: Record<string, string>
    }
    expect(Object.keys(manifest.modules)).toContain('shared/contact-form.tsx')
    const form = await h.json<{
      alias: string
      pages: { groups: { fields: { alias: string }[] }[] }[]
    }>(`${API}/forms/writeToTheDesk`)
    expect(form.pages[0]?.groups[0]?.fields.map((f) => f.alias)).toEqual([
      'readerName',
      'readerEmail',
      'reason',
      'storyLink',
      'message',
      'consent',
    ])
  })

  test('the newsroom’s groups come from its files', async () => {
    const groups = new UserGroupRepository(h.server.db)
    const subEditors = await groups.byAlias('subEditors')
    const editors = await groups.byAlias('editors')
    const writers = await groups.byAlias('writers')
    expect(subEditors?.name).toBe('Sub-editors')
    expect(editors?.permissions).toContain('Umb.Document.Publish')
    expect(writers?.permissions).not.toContain('Umb.Document.Publish')
  })

  test('an article is sent for approval rather than published, administrators included', async () => {
    // A seeded page's key comes from its path.
    const key = seedKey('content/plain-signal/health/antibiotics-designed-from-scratch')
    const published = await h.put(`${V1}/document/${key}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    expect(published.status).toBeGreaterThanOrEqual(400)
    expect(await published.text()).toContain('Article approval')
  })
})
