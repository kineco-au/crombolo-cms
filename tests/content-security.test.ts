/**
 * Story 313: the back office's pages send a content security policy. They talk
 * to the site, and to the origins granted extensions declare in
 * `http.outbound`, and nowhere else; inline scripts carry the page's nonce; the
 * browser reports what it blocks to the site's log.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { backOfficePolicy } from '@crombolo/backoffice-host'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const directive = (policy: string, name: string) =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) ?? []

describe('the policy', () => {
  test('the site, the nonce, and what the granted extensions declare', () => {
    const policy = backOfficePolicy({
      nonce: 'abc',
      connect: ['https://api.acme.com/v1', 'not a url'],
      media: ['https://cdn.acme.com/media/x.jpg'],
      frames: ['https://www.acme.com'],
      reportUri: '/umbraco/crombolo/api/csp-report',
    })
    expect(directive(policy, 'default-src')).toEqual(["'self'"])
    expect(directive(policy, 'script-src')).toEqual(["'self'", "'nonce-abc'"])
    expect(directive(policy, 'connect-src')).toEqual(["'self'", 'https://api.acme.com'])
    expect(directive(policy, 'img-src')).toContain('https://cdn.acme.com')
    expect(directive(policy, 'frame-src')).toContain('https://www.acme.com')
    expect(directive(policy, 'frame-ancestors')).toEqual(["'self'"])
    expect(directive(policy, 'object-src')).toEqual(["'none'"])
    expect(directive(policy, 'report-uri')).toEqual(['/umbraco/crombolo/api/csp-report'])
  })
})

/** A site with an extension whose screens may reach https://api.acme.test. */
function siteWithScreens() {
  return siteDeclaring('content-security', {
    '@acme/reports': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'reports',
          name: 'Reports',
          server: 'reports',
          permissions: {
            'http.outbound': { reason: 'Reads its report', origins: ['https://api.acme.test'] },
          },
          extensions: [
            {
              type: 'dashboard',
              alias: 'Acme.Dashboard.Reports',
              name: 'Reports',
              element: 'r.js',
            },
          ],
        },
      },
      files: {
        'index.js': `export function reports() { return { id: 'reports', section: 'settings', capabilities: [] } }\n`,
        'r.js': 'export default class {}\n',
      },
    },
  })
}

describe('the back office', () => {
  test('sends the policy, its nonce on the inline scripts, and a granted extension’s origins', async () => {
    const dir = siteWithScreens()
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { reports: { grant: ['http.outbound'], origins: ['https://api.acme.test'] } },
      },
    })
    open.push(h)
    const page = await h.call(`${BACKOFFICE}/section/content`)
    const policy = page.headers.get('content-security-policy') ?? ''
    expect(directive(policy, 'connect-src')).toEqual(["'self'", 'https://api.acme.test'])
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1] as string
    expect(nonce).toBeDefined()
    const html = await page.text()
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map((m) => m[1] as string)
    expect(inline.length).toBeGreaterThan(0)
    for (const attributes of inline) expect(attributes).toContain(`nonce="${nonce}"`)

    // A nonce is the page's own.
    const again = (await h.call(`${BACKOFFICE}/section/content`)).headers.get(
      'content-security-policy',
    )
    expect(again).not.toContain(`'nonce-${nonce}'`)

    // The sign-in page has one too; the site's own pages do not.
    expect((await h.call(`${BACKOFFICE}/login`)).headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    )
    expect((await h.call('/')).headers.get('content-security-policy') ?? '').not.toContain('nonce-')
  })

  test('an extension that is not granted adds nothing', async () => {
    const dir = siteWithScreens()
    const h = await signedInServer({
      config: { siteDir: dir, componentsDir: join(dir, 'components') },
    })
    open.push(h)
    const policy =
      (await h.call(`${BACKOFFICE}/section/content`)).headers.get('content-security-policy') ?? ''
    expect(directive(policy, 'connect-src')).toEqual(["'self'"])
  })

  test('a host’s origin is reachable, beside a granted extension’s, each once (story 318)', async () => {
    const dir = siteWithScreens()
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { reports: { grant: ['http.outbound'], origins: ['https://api.acme.test'] } },
        host: {
          origin: 'https://console.example.com',
          signingKey: 'a key of at least thirty-two bytes, kept by the host',
          keyId: 'installation-1',
        },
      },
    })
    open.push(h)
    for (const path of ['section/content', 'login']) {
      const policy =
        (await h.call(`${BACKOFFICE}/${path}`)).headers.get('content-security-policy') ?? ''
      expect(directive(policy, 'connect-src')).toEqual([
        "'self'",
        'https://api.acme.test',
        'https://console.example.com',
      ])
    }
  })

  test('what the browser blocked is taken, without signing in, and refused when it is not a report', async () => {
    const h = await signedInServer()
    open.push(h)
    const report = await h.call(`${BACKOFFICE}/crombolo/api/csp-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report' },
      body: JSON.stringify({
        'csp-report': {
          'document-uri': 'http://localhost/umbraco/section/content?secret=1',
          'violated-directive': 'connect-src',
          'blocked-uri': 'https://evil.example/collect?data=1',
        },
      }),
    })
    expect(report.status).toBe(204)
    const junk = await h.call(`${BACKOFFICE}/crombolo/api/csp-report`, {
      method: 'POST',
      body: 'x'.repeat(20_000),
    })
    expect(junk.status).toBe(413)
  })
})
