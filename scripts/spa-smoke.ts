/**
 * The single-page Harbourstone, end to end in a real browser (story 347):
 *
 *   bun run smoke:spa [--keep]
 *
 * Packs `@crombolo/delivery-client` as it publishes, scaffolds
 * `demo/harbourstone-spa` with `crombolo init` under `output/` (its CMS runs on the
 * working tree, as the integration suite's sites do), installs the app's packages in
 * `web/` alone, builds the static export, and starts the CMS and `serve.ts` on ports
 * of their own. A single-page app renders only with JavaScript, so a fetch proves
 * nothing: Chromium follows links, goes back and forward, opens an address
 * directly, sends the contact form, signs a member in and out, and opens a draft
 * the way the Preview button does. CI runs it.
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { connect } from '@crombolo/data'
import { chromium, type Page } from '@playwright/test'
import {
  previewSigningSecret,
  previewUser,
  signPreviewToken,
} from '../packages/server/src/preview-tokens.ts'
import { buildDeliveryClient, builtManifest } from './delivery-client.ts'
import { ROOT } from './packages.ts'
import { listSites, stageTemplates } from './sites.ts'

const ABOUT_PAGE = 'cb4c569e-c28a-43b6-a4d7-d33bb544e973'
const DRAFT = 'A draft no visitor sees yet.'
const MEMBER = { email: 'smoke@example.com', password: 'harbour-smoke-password-1' }
const ADMIN_PASSWORD = 'harbour-smoke-admin-1'

mkdirSync(join(ROOT, 'output'), { recursive: true })
const work = mkdtempSync(join(ROOT, 'output', 'spa-smoke-'))
const packs = join(work, 'packs')
const site = join(work, 'site')
const web = join(site, 'web')
const cli = join(ROOT, 'packages/cli/bin/crombolo.ts')
const children: Array<{ kill(): void }> = []
const failures: string[] = []

/** The environment a site runs in: none of the test harness's own paths. */
function siteEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) }
  for (const name of Object.keys(env)) if (name.startsWith('CROMBOLO_')) delete env[name]
  return { ...env, NEXT_TELEMETRY_DISABLED: '1', ...extra }
}

function run(command: string[], cwd: string, env = siteEnv(), stdin?: string): string {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0)
    throw new Error(`${command.join(' ')} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.toString()
}

const freePort = () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port as number
  server.stop(true)
  return port
}

/** Until `url` answers 200, for an address that is up only once there is something to show. */
async function waitForOk(url: string, seconds = 120): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    const answer = await fetch(url).catch(() => null)
    if (answer?.ok) return
    await Bun.sleep(500)
  }
  throw new Error(`${url} did not answer within ${seconds}s`)
}

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures.push(label)
}

/** One check in the browser: a step that throws, or times out waiting, fails it. */
async function step(label: string, body: () => Promise<unknown>) {
  try {
    check(label, (await body()) !== false)
  } catch (error) {
    check(label, false, error instanceof Error ? error.message.split('\n')[0] : String(error))
  }
}

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true }).waitFor({ timeout: 15_000 })

/** Every file under a directory, as text. */
function filesUnder(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { path, text: readFileSync(path, 'utf8') }
    })
}

/** A preview token for the administrator, as the back office's Preview button issues one. */
async function previewToken(): Promise<string> {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'crombolo.sqlite') })
  try {
    const admin = await db.q
      .selectFrom('user_account')
      .select(['id'])
      .where('login', '=', 'admin@crombolo.local')
      .executeTakeFirstOrThrow()
    const editor = await previewUser(db, { id: Number(admin.id) })
    if (!editor) throw new Error('the administrator cannot preview')
    return signPreviewToken(await previewSigningSecret(db), {
      user: editor.id,
      stamp: editor.stamp,
      expires: Date.now() + 10 * 60_000,
    })
  } finally {
    await db.close()
  }
}

try {
  console.log(`demo/harbourstone-spa, in ${work}`)
  const manifestFile = join(ROOT, 'packages/delivery-client/package.json')
  const source = readFileSync(manifestFile, 'utf8')
  try {
    await buildDeliveryClient(join(ROOT, 'packages/delivery-client'))
    writeFileSync(manifestFile, `${JSON.stringify(builtManifest(JSON.parse(source)), null, 2)}\n`)
    run(['bun', 'pm', 'pack', '--destination', packs], join(ROOT, 'packages/delivery-client'))
  } finally {
    writeFileSync(manifestFile, source)
    rmSync(join(ROOT, 'packages/delivery-client/dist'), { recursive: true, force: true })
  }
  const tarball = join(
    packs,
    readdirSync(packs).find((f) => f.startsWith('crombolo-delivery-client')) as string,
  )

  // The CLI's own templates and the distributed sites, staged as packing does.
  const templates = join(work, 'templates')
  cpSync(join(ROOT, 'packages/cli/templates'), templates, { recursive: true })
  stageTemplates(
    templates,
    listSites().filter((s) => s.distribute),
  )
  mkdirSync(site, { recursive: true })
  run(
    ['bun', cli, 'init', '--template', 'demo/harbourstone-spa', '--name', 'Smoke'],
    site,
    siteEnv({ CROMBOLO_TEMPLATES_DIR: templates }),
  )

  // Installed in web/ alone, from the pack, so nothing comes from the workspace.
  const siteManifest = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'))
  delete siteManifest.workspaces
  writeFileSync(join(site, 'package.json'), `${JSON.stringify(siteManifest, null, 2)}\n`)
  const manifest = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'))
  manifest.dependencies['@crombolo/delivery-client'] = `file:${tarball}`
  writeFileSync(join(web, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  run(['npm', 'install', '--no-audit', '--no-fund'], web)

  const cms = `http://localhost:${freePort()}`
  const app = `http://localhost:${freePort()}`
  children.push(
    Bun.spawn(['bun', cli, 'start', '--bundle', '.', '--publish'], {
      cwd: site,
      env: siteEnv({
        PORT: new URL(cms).port,
        CROMBOLO_APP_URL: app,
        CROMBOLO_ADMIN_PASSWORD: ADMIN_PASSWORD,
      }),
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  )
  await waitForOk(`${cms}/crombolo/delivery/api/v2/route?path=/`)

  // What `bun run dev` does once the CMS is up, then a member to sign in as and a
  // draft to preview, through the command line as a developer would.
  console.log(run(['bun', 'members.ts'], site).trim())
  run(
    [
      'bun',
      cli,
      'members',
      'new',
      MEMBER.email,
      '--type',
      'Member',
      '--group',
      'Members',
      '--stdin',
    ],
    site,
    siteEnv(),
    MEMBER.password,
  )
  run(['bun', cli, 'content', 'update', ABOUT_PAGE, '--set', `standfirst=${DRAFT}`], site)
  const token = await previewToken()

  const next = join(web, 'node_modules/next/dist/bin/next')
  run(['node', next, 'build'], web, siteEnv({ CROMBOLO_URL: cms }))
  children.push(
    Bun.spawn(['bun', 'serve.ts'], {
      cwd: site,
      env: siteEnv({ CROMBOLO_APP_URL: app }),
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  )
  await waitForOk(app)

  const built = filesUnder(join(web, 'out'))
  const secretKey = /CROMBOLO_SECRET_KEY=(.*)/.exec(readFileSync(join(site, '.env'), 'utf8'))?.[1]
  const secrets = [secretKey, ADMIN_PASSWORD, MEMBER.password].filter(Boolean) as string[]
  check(
    'no key or secret is in the built app',
    built.every((file) => !secrets.some((secret) => file.text.includes(secret))),
  )
  check(
    'the built app reads from the CMS',
    built.some((file) => file.text.includes(cms)),
  )

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await step('the home page renders in the browser', async () => {
      await page.goto(app)
      await heading(page, 'Harbourstone')
    })
    await step('a link is followed in the app, without loading the page again', async () => {
      // Gone if the page loads again: what a link in a single-page app must not do.
      await page.evaluate(() => Object.assign(window, { kept: true }))
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Bottlings' })
        .click()
      await heading(page, 'Bottlings on offer.')
      await page.getByRole('link', { name: 'Haar', exact: true }).first().click()
      await heading(page, 'Haar')
      return await page.evaluate(() => 'kept' in window)
    })
    await step('back and forward', async () => {
      await page.goBack()
      await heading(page, 'Bottlings on offer.')
      await page.goForward()
      await heading(page, 'Haar')
    })
    await step('an address opened directly', async () => {
      await page.goto(`${app}/bottlings/haar`)
      await heading(page, 'Haar')
    })
    await step('an address that is no page shows the app’s not-found', async () => {
      await page.goto(`${app}/no-such-page-at-all`)
      await heading(page, 'There is no page here.')
    })
    await step('the contact form sends', async () => {
      await page.goto(`${app}/contact`)
      await page.getByLabel('Name', { exact: true }).fill('Smoke Test')
      await page.getByLabel('Email', { exact: true }).fill('visitor@example.com')
      await page.getByLabel('Message', { exact: true }).fill('A bottle of Haar, please.')
      await page.getByLabel(/happy for Harbourstone/).check()
      // The form refuses an answer quicker than a person could give one.
      await Bun.sleep(3_500)
      await page.getByRole('button', { name: 'Send message' }).click()
      await page.getByText('Received.').waitFor({ timeout: 15_000 })
    })
    await step('the members’ page asks someone not signed in to sign in', async () => {
      await page.goto(`${app}/members`)
      await heading(page, 'This page is for members.')
    })
    await step('a member signs in on the site and sees the members’ page', async () => {
      await page.getByRole('main').getByRole('button', { name: 'Sign in' }).click()
      await page.getByLabel('E-mail address').fill(MEMBER.email)
      await page.getByLabel('Password').fill(MEMBER.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await heading(page, "The members' cellar.")
      return new URL(page.url()).origin === app
    })
    await step('the nav lists the members’ page to a member', async () => {
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: 'Members' })
        .waitFor({ timeout: 15_000 })
    })
    await step('a member signs out, and the members’ page is closed again', async () => {
      await page.getByRole('button', { name: 'Sign out' }).click()
      await heading(page, 'Harbourstone')
      await page.goto(`${app}/members`)
      await heading(page, 'This page is for members.')
    })

    const editor = await browser.newPage()
    await step('Preview shows a draft', async () => {
      await editor.goto(`${app}/preview?path=${encodeURIComponent('/about')}&token=${token}`)
      await editor.getByText(DRAFT).waitFor({ timeout: 15_000 })
      await editor.getByText('Previewing drafts').waitFor()
      return new URL(editor.url()).pathname === '/about'
    })
    await step('a visitor sees what is published, not the draft', async () => {
      const visitor = await browser.newPage()
      await visitor.goto(`${app}/about`)
      await heading(visitor, 'Built for weather, not for show.')
      return (await visitor.getByText(DRAFT).count()) === 0
    })
  } finally {
    await browser.close()
  }
} finally {
  for (const child of children) child.kill()
  if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('\nThe single-page app: every check passed.')
