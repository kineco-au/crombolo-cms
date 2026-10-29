/**
 * The Next.js front end, end to end on one Next.js major (story 208):
 *
 *   bun run scripts/next-smoke.ts --next 16 [--template next|demo/harbourstone-next]
 *
 * Packs `@crombolo/delivery-client` and `@crombolo/next-integration` as they
 * publish, scaffolds a site with `crombolo init` under `output/` (its CMS
 * runs on the working tree, as the integration suite's sites do), installs the
 * chosen Next.js and the packs into its `web/` alone, starts the CMS and the built app, and checks what they answer. On
 * Next.js 15 the app is moved to that major's caching adapter and middleware
 * file, as docs/delivery-api.md, "A Next.js front end", tells a site to.
 * CI runs it for both majors.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { buildPackage, builtPackageManifest } from './built-package.ts'
import { buildDeliveryClient, builtManifest } from './delivery-client.ts'
import { type Manifest, ROOT } from './packages.ts'
import { listSites, stageTemplates } from './sites.ts'

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? (process.argv[at + 1] as string) : fallback
}
const major = arg('--next', '16')
const templateId = arg('--template', 'next')
const NEXT_VERSIONS: Record<string, string> = { '15': '15.5.28', '16': '16.4.3' }
if (!NEXT_VERSIONS[major]) throw new Error(`--next must be 15 or 16, not ${major}`)

mkdirSync(join(ROOT, 'output'), { recursive: true })
const work = mkdtempSync(join(ROOT, 'output', 'next-smoke-'))
const packs = join(work, 'packs')
const site = join(work, 'site')
const web = join(site, 'web')
const children: Array<{ kill(): void }> = []
const failures: string[] = []

function run(command: string[], cwd: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0)
    throw new Error(`${command.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.toString()
}

/** Packs a package under the manifest it publishes with, and puts its source manifest back. */
async function pack(
  dir: string,
  build: (dir: string) => Promise<void>,
  manifestFor: (m: Manifest) => Manifest,
) {
  const file = join(dir, 'package.json')
  const source = readFileSync(file, 'utf8')
  try {
    await build(dir)
    writeFileSync(file, `${JSON.stringify(manifestFor(JSON.parse(source) as Manifest), null, 2)}\n`)
    for (const notice of ['NOTICE', 'LICENSE'])
      if (existsSync(join(ROOT, notice))) cpSync(join(ROOT, notice), join(dir, notice))
    run(['bun', 'pm', 'pack', '--destination', packs], dir)
  } finally {
    writeFileSync(file, source)
    rmSync(join(dir, 'dist'), { recursive: true, force: true })
    for (const notice of ['NOTICE', 'LICENSE']) rmSync(join(dir, notice), { force: true })
  }
}

/** The environment a site runs in: none of the test harness's own paths. */
function siteEnv(extra: Record<string, string>): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) }
  for (const name of Object.keys(env)) if (name.startsWith('CROMBOLO_')) delete env[name]
  return { ...env, NEXT_TELEMETRY_DISABLED: '1', ...extra }
}

async function waitFor(url: string, seconds = 90): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {}
    await Bun.sleep(500)
  }
  throw new Error(`${url} did not answer within ${seconds}s`)
}

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures.push(label)
}

const freePort = () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port as number
  server.stop(true)
  return port
}

try {
  console.log(`Next.js ${NEXT_VERSIONS[major]}, template ${templateId}, in ${work}`)
  await pack(join(ROOT, 'packages/delivery-client'), buildDeliveryClient, builtManifest)
  await pack(join(ROOT, 'packages/common'), buildPackage, builtPackageManifest)
  await pack(join(ROOT, 'packages/next-integration'), buildPackage, builtPackageManifest)
  const tarball = (prefix: string) =>
    join(packs, readdirSync(packs).find((f) => f.startsWith(prefix)) as string)

  // The CLI's own templates and the distributed sites, staged as packing does.
  const templates = join(work, 'templates')
  cpSync(join(ROOT, 'packages/cli/templates'), templates, { recursive: true })
  stageTemplates(
    templates,
    listSites().filter((s) => s.distribute),
  )
  const cli = join(ROOT, 'packages/cli/bin/crombolo.ts')
  Bun.spawnSync(['mkdir', '-p', site])
  run(
    ['bun', cli, 'init', '--template', templateId, '--name', 'Smoke'],
    site,
    siteEnv({ CROMBOLO_TEMPLATES_DIR: templates }),
  )

  // Installed in web/ alone, from the packs, so nothing comes from the workspace;
  // the site's own `workspaces` would have npm hoist it into the site instead.
  const siteManifest = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'))
  delete siteManifest.workspaces
  writeFileSync(join(site, 'package.json'), `${JSON.stringify(siteManifest, null, 2)}\n`)
  const manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'))
  manifest.dependencies['@crombolo/next-integration'] =
    `file:${tarball('crombolo-next-integration')}`
  // Direct as well as overridden: npm satisfies the package's own range from these,
  // where an override alone is not applied to a version the registry lacks.
  manifest.dependencies['@crombolo/common'] = `file:${tarball('crombolo-common')}`
  manifest.dependencies['@crombolo/delivery-client'] = `file:${tarball('crombolo-delivery-client')}`
  manifest.dependencies.next = NEXT_VERSIONS[major]
  manifest.overrides = {
    '@crombolo/delivery-client': `file:${tarball('crombolo-delivery-client')}`,
  }
  writeFileSync(join(web, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (major === '15') {
    // Next.js 15 reads next.config.ts through TypeScript's JavaScript API, which TypeScript 7 has not got.
    manifest.devDependencies.typescript = '5.9.3'
    writeFileSync(join(web, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const lib = join(web, 'lib/crombolo.ts')
    writeFileSync(
      lib,
      readFileSync(lib, 'utf8').replaceAll('cache-16', 'cache-15').replaceAll('cache16', 'cache15'),
    )
    renameSync(join(web, 'proxy.ts'), join(web, 'middleware.ts'))
    const config = join(web, 'next.config.ts')
    writeFileSync(
      config,
      readFileSync(config, 'utf8')
        .split('\n')
        .filter((line) => !/cacheComponents|partialPrefetching|'use cache'/.test(line))
        .join('\n'),
    )
  }
  run(['npm', 'install', '--no-audit', '--no-fund'], web)

  const cmsPort = freePort()
  const appPort = freePort()
  const env = readFileSync(join(web, '.env.local'), 'utf8').replace(
    /CROMBOLO_URL=.*/,
    `CROMBOLO_URL=http://localhost:${cmsPort}`,
  )
  writeFileSync(
    join(web, '.env.local'),
    env.replace(/CROMBOLO_APP_URL=.*/, `CROMBOLO_APP_URL=http://localhost:${appPort}`),
  )
  const secret = /CROMBOLO_REVALIDATE_SECRET=(.*)/.exec(env)?.[1] as string

  const start = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'))
    .scripts.start.split(' ')
    .slice(1)
  children.push(
    Bun.spawn(['bun', cli, ...start], {
      cwd: site,
      env: siteEnv({ PORT: String(cmsPort), CROMBOLO_APP_URL: `http://localhost:${appPort}` }),
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  )
  await waitFor(`http://localhost:${cmsPort}/crombolo/delivery/api/v2/route?path=/`)

  const next = join(web, 'node_modules/next/dist/bin/next')
  run(['node', next, 'build'], web, siteEnv({}))
  children.push(
    Bun.spawn(['node', next, 'start', '--port', String(appPort)], {
      cwd: web,
      env: siteEnv({}),
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  )
  const app = `http://localhost:${appPort}`
  await waitFor(`${app}/api/crombolo/preview`)

  const home = await fetch(app)
  const html = await home.text()
  if (templateId === 'next') {
    check('an empty site answers not found at /', home.status === 404, String(home.status))
  } else {
    check(
      'the home page renders',
      home.status === 200 && html.includes('Harbourstone'),
      String(home.status),
    )
    const compare = await fetch(`${app}/compare`)
    check('the comparison page renders', compare.status === 200, String(compare.status))
  }
  const missing = await fetch(`${app}/no-such-page-at-all`)
  check('a missing page is a 404', missing.status === 404, String(missing.status))
  check(
    'preview without a token is refused',
    (await fetch(`${app}/api/crombolo/preview?path=/`)).status === 401,
  )
  const revalidate = (header: string) =>
    fetch(`${app}/api/crombolo/revalidate`, {
      method: 'POST',
      headers: { 'x-crombolo-secret': header, 'content-type': 'application/json' },
      body: JSON.stringify({ Id: crypto.randomUUID(), Ancestors: [] }),
    })
  check('revalidation refuses the wrong secret', (await revalidate('wrong')).status === 401)
  check('revalidation takes the right one', (await revalidate(secret)).status === 200)
} finally {
  for (const child of children) child.kill()
  if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed on Next.js ${major}.`)
  process.exit(1)
}
console.log(`\nNext.js ${major}: every check passed.`)
