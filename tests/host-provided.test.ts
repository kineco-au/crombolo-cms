/**
 * Story 177: the packages an installation provides to every site it runs stay
 * with it. A whole-site file neither names them nor needs them, so the site
 * starts anywhere that has the bundles it chose itself.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  exportSite,
  extractTarball,
  requiresProblems,
  type ServerBundle,
  unknownHostProvided,
} from '@crombolo/server'
import { loadBundle } from '@crombolo/transfer'
import { siteDeclaring } from './support/bundles.ts'
import { type Harness, signedInServer } from './support/harness.ts'

const HOST = '@host/tool'
const OWN = 'site-own-bundle'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

/** A package carrying a bundle's server half, as the site's `node_modules` holds it. */
const serverPackage = (id: string) => ({
  json: {
    crombolo: { id, name: id, server: id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()) },
  },
})

const bundle = (id: string): ServerBundle => ({
  id,
  section: 'settings',
  capabilities: [],
  routes: [],
})

/** A site wiring the host's tool and a bundle of its own, the host's listed as provided. */
async function hosted(): Promise<{ h: Harness; root: string }> {
  const root = siteDeclaring('host-provided', {
    [HOST]: serverPackage('host-tool'),
    [OWN]: serverPackage('site-own'),
  })
  dirs.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      bundles: [bundle('host-tool'), bundle('site-own')],
      hostProvided: [HOST],
    },
  })
  open.push(h)
  return { h, root }
}

async function exported(h: Harness) {
  const out = join(mkdtempSync(join(process.cwd(), 'output', 'host-provided-out-')), 'site.tgz')
  dirs.push(join(out, '..'))
  await exportSite(h.server.db, h.server.config, { out })
  const unpacked = mkdtempSync(join(process.cwd(), 'output', 'host-provided-unpacked-'))
  dirs.push(unpacked)
  await extractTarball(out, unpacked)
  const loaded = loadBundle(join(unpacked, 'content'))
  if (!loaded.set) throw new Error(loaded.problems.map((p) => p.message).join('; '))
  return { manifest: loaded.set.manifest, dir: unpacked }
}

describe('a whole-site file from a host', () => {
  test('requires only the bundles the site chose, and names the host’s nowhere', async () => {
    const { h } = await hosted()
    const { manifest, dir } = await exported(h)
    expect(manifest.requires).toEqual({ [OWN]: '1.0.0' })
    expect(JSON.stringify(manifest)).not.toContain(HOST)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).not.toContain(HOST)
  })

  test('starts on an installation that has only the site’s own bundle', async () => {
    const { h } = await hosted()
    const { manifest } = await exported(h)
    const elsewhere = siteDeclaring('host-provided-elsewhere', { [OWN]: serverPackage('site-own') })
    dirs.push(elsewhere)
    expect(requiresProblems(manifest, elsewhere)).toEqual([])
    // Without the filter the same site would be refused there.
    const bare = siteDeclaring('host-provided-bare', {})
    dirs.push(bare)
    expect(requiresProblems(manifest, bare)).toHaveLength(1)
  })

  test('a file written before, naming the host’s package, still imports on that host', async () => {
    const { root } = await hosted()
    expect(
      requiresProblems(
        {
          ...(await exported((await hosted()).h)).manifest,
          requires: { [HOST]: '1.0.0', [OWN]: '1.0.0' },
        },
        root,
      ),
    ).toEqual([])
  })
})

describe('the list itself', () => {
  test('a name nothing here provides is said once at start, not refused', async () => {
    const { root } = await hosted()
    expect(
      unknownHostProvided({ siteDir: root, hostProvided: [HOST, '@host/coming-soon'] }),
    ).toEqual(['@host/coming-soon'])
  })

  test('is set in code only, as `bundles` is', () => {
    const config = readFileSync(join(process.cwd(), 'packages/server/src/config.ts'), 'utf8')
    expect(config).not.toMatch(/CROMBOLO_HOST_PROVIDED/)
  })
})
