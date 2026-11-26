/**
 * Story 087: the built image checked as a cloud console would start it.
 *
 *   bun run image:build && bun run image:check
 *
 * With only a setup code, it reaches "Set up your new site", runs as a user other than
 * root, keeps its state in /data and has Deno; with Postgres settings, it uses Postgres.
 */
const IMAGE = Bun.env.CROMBOLO_IMAGE ?? 'crombolo:local'
const CODE = 'image-check-setup-code-0123'

const sh = (args: string[], quiet = false) => {
  const run = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
  const out = `${run.stdout.toString()}${run.stderr.toString()}`.trim()
  if (run.exitCode !== 0 && !quiet) throw new Error(`${args.join(' ')}\n${out}`)
  return out
}
const started: string[] = []
const networks: string[] = []
const cleanUp = () => {
  for (const id of started) sh(['docker', 'rm', '-f', id], true)
  for (const net of networks) sh(['docker', 'network', 'rm', net], true)
}

async function until(url: string, ok: (r: Response, body: string) => boolean, what: string) {
  for (let i = 0; i < 90; i++) {
    const r = await fetch(url).catch(() => undefined)
    if (r) {
      const body = await r.text()
      if (ok(r, body)) return body
    }
    await Bun.sleep(1000)
  }
  throw new Error(`timed out waiting for ${what} at ${url}`)
}

const portOf = (id: string) => sh(['docker', 'port', id, '8080']).split('\n')[0]?.split(':').at(-1)

try {
  // A cloud console's start: a setup code, nothing else.
  const first = sh([
    'docker',
    'run',
    '-d',
    '-p',
    '0:8080',
    '-e',
    `CROMBOLO_SETUP_CODE=${CODE}`,
    IMAGE,
  ])
  started.push(first)
  const url = `http://127.0.0.1:${portOf(first)}`
  const setup = await until(`${url}/crombolo/setup`, (r) => r.status === 200, 'the setup page')
  if (!setup.includes('Set up your new site')) throw new Error('the setup page does not say so')
  if (setup.includes(CODE)) throw new Error('the setup page shows the code')
  const uid = sh(['docker', 'exec', first, 'id', '-u'])
  if (uid === '0') throw new Error('it runs as root')
  const data = sh(['docker', 'exec', first, 'ls', '/data'])
  for (const kept of ['crombolo.sqlite', 'site', 'logs'])
    if (!data.split(/\s+/).includes(kept)) throw new Error(`/data holds no ${kept}: ${data}`)
  // Deno, as the `deno` package installs it for this platform: extensions run under it.
  sh([
    'docker',
    'exec',
    first,
    'sh',
    '-c',
    '"$(ls /opt/crombolo/node_modules/@deno/*/deno | head -1)" --version',
  ])
  console.log(
    'ok  a setup code reaches "Set up your new site", as a user, its state in /data, with Deno',
  )

  // With Postgres settings, it uses Postgres.
  const net = `crombolo-image-check-${Date.now()}`
  sh(['docker', 'network', 'create', net])
  networks.push(net)
  const db = sh([
    'docker',
    'run',
    '-d',
    '--network',
    net,
    '--name',
    `${net}-db`,
    '-e',
    'POSTGRES_USER=crombolo',
    '-e',
    'POSTGRES_PASSWORD=crombolo',
    '-e',
    'POSTGRES_DB=crombolo',
    'postgres:18-alpine',
  ])
  started.push(db)
  const second = sh([
    'docker',
    'run',
    '-d',
    '--network',
    net,
    '-p',
    '0:8080',
    '-e',
    'CROMBOLO_DB=postgres',
    '-e',
    `CROMBOLO_POSTGRES_URL=postgres://crombolo:crombolo@${net}-db:5432/crombolo`,
    '-e',
    'CROMBOLO_ADMIN_PASSWORD=an image check password',
    IMAGE,
  ])
  started.push(second)
  await until(
    `http://127.0.0.1:${portOf(second)}/health`,
    (r) => r.status === 200,
    'a healthy Postgres site',
  )
  if (sh(['docker', 'exec', second, 'ls', '/data']).includes('crombolo.sqlite'))
    throw new Error('it made a SQLite file beside Postgres')
  console.log('ok  with Postgres settings, it uses Postgres and is healthy')
} catch (error) {
  for (const id of started) console.error(sh(['docker', 'logs', '--tail', '40', id], true))
  cleanUp()
  throw error
}
cleanUp()
