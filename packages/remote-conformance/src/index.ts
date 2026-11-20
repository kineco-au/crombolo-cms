/**
 * The conformance suite for the Crombolo remote protocol, version 1 (story
 * 107): what any implementation is held to, run against its own endpoint. It
 * needs nothing but `fetch`, so a host that is not this CMS runs it unchanged.
 * The specification is `docs/remote-protocol.md`.
 *
 * Read-only unless `push` is given: a push replaces the environment it goes to.
 * The checks that a push is refused for a wrong hash are always run, since a
 * conforming remote changes nothing for them.
 */

export interface ConformanceOptions {
  /** The site's origin, e.g. `https://example.com`. */
  url: string
  /** A bearer token from the device grant, for someone allowed to pull. */
  token: string
  /** The environment to test; the first one discovery names, when not given. */
  environment?: string
  /** At least 12 characters; the pulled file is sealed with it. */
  passphrase?: string
  /** Push the pulled file back, replacing the environment with itself. */
  push?: boolean
  /** How long to wait for a job, in milliseconds. */
  timeoutMs?: number
  /**
   * Mints a token one of the providers `auth.people` names issued for the
   * remote, for a person signed in to it once (story 364): the exchange is
   * then checked end to end. Without it, only its refusals are.
   */
  personToken?: (provider: { id: string; issuer: string; audience: string }) => Promise<string>
  fetch?: typeof fetch
}

export interface ConformanceCheck {
  name: string
  ok: boolean
  skipped?: boolean
  detail?: string
}

export interface ConformanceReport {
  passed: boolean
  checks: ConformanceCheck[]
}

class Failed extends Error {}

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Failed(message)
}

type Json = Record<string, unknown>

export async function runConformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const http = options.fetch ?? fetch
  const origin = options.url.replace(/\/+$/, '')
  const passphrase = options.passphrase ?? 'conformance suite passphrase'
  const timeout = options.timeoutMs ?? 5 * 60 * 1000
  const checks: ConformanceCheck[] = []
  const state: {
    discovery?: Json
    api?: string
    environment?: string
    may?: Json
    pulled?: { bytes: Uint8Array; sha256: string }
  } = {}

  const check = async (name: string, run: () => Promise<undefined | 'skip'>) => {
    try {
      const outcome = await run()
      checks.push(outcome === 'skip' ? { name, ok: true, skipped: true } : { name, ok: true })
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const authorised = (init: RequestInit = {}): RequestInit => {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${options.token}`)
    return { ...init, headers }
  }
  const api = (path: string, init?: RequestInit) => http(`${state.api}/${path}`, authorised(init))
  const isProblem = (response: Response) =>
    (response.headers.get('content-type') ?? '').includes('application/problem+json')
  const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

  const settle = async (id: string): Promise<Json> => {
    const deadline = Date.now() + timeout
    for (;;) {
      const response = await api(`jobs/${id}`)
      assert(response.status === 200, `polling a job answered ${response.status}`)
      const job = (await response.json()) as Json
      if (job.state !== 'queued' && job.state !== 'running') return job
      assert(Date.now() < deadline, `the job was still ${job.state} after ${timeout} ms`)
      await Bun.sleep(Math.max(250, Number(job.pollAfter ?? 1) * 1000))
    }
  }

  await check('discovery names the protocol, versions, sign-in and environments', async () => {
    const response = await http(`${origin}/.well-known/crombolo-remote`)
    assert(response.status === 200, `answered ${response.status}`)
    const body = (await response.json()) as Json
    assert(body.protocol === 'crombolo-remote', 'protocol is not "crombolo-remote"')
    assert(
      Array.isArray(body.versions) && body.versions.includes('1'),
      'versions does not include "1"',
    )
    assert(typeof body.api === 'string', 'api is missing')
    const auth = body.auth as Json | undefined
    for (const field of ['deviceAuthorization', 'token', 'clientId'])
      assert(typeof auth?.[field] === 'string', `auth.${field} is missing`)
    const environments = body.environments as Json[] | undefined
    assert(Array.isArray(environments) && environments.length > 0, 'no environments')
    for (const env of environments ?? [])
      assert(
        typeof env.id === 'string' &&
          typeof env.name === 'string' &&
          typeof env.protected === 'boolean',
        'an environment lacks id, name or protected',
      )
    state.discovery = body
    state.api = String(body.api).replace(/\/+$/, '')
    state.environment = options.environment ?? String((environments?.[0] as Json | undefined)?.id)
  })
  if (!state.api) return { passed: false, checks }

  await check('the device authorization endpoint hands out codes', async () => {
    const auth = state.discovery?.auth as Json
    const response = await http(String(auth.deviceAuthorization), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: String(auth.clientId) }).toString(),
    })
    assert(response.status === 200, `answered ${response.status}`)
    const body = (await response.json()) as Json
    for (const field of ['device_code', 'user_code', 'verification_uri'])
      assert(typeof body[field] === 'string', `${field} is missing`)
    for (const field of ['expires_in', 'interval'])
      assert(typeof body[field] === 'number', `${field} is missing`)
  })

  // Optional: signing in from CI (story 160). A remote that offers it says how, and
  // refuses a token it cannot verify with the same answer whatever was wrong.
  const ci = (state.discovery?.auth as Json | undefined)?.ci as Json | undefined
  const capabilities = (state.discovery?.capabilities as unknown[] | undefined) ?? []
  if (capabilities.includes('ci-sign-in')) {
    await check('ci-sign-in: discovery names the exchange, its audience and issuers', async () => {
      for (const field of ['tokenExchange', 'grantType', 'subjectTokenType', 'audience'])
        assert(typeof ci?.[field] === 'string', `auth.ci.${field} is missing`)
      assert(Array.isArray(ci?.issuers), 'auth.ci.issuers is missing')
      assert(
        ci?.grantType === 'urn:ietf:params:oauth:grant-type:token-exchange',
        'auth.ci.grantType is not token exchange',
      )
    })
    await check('ci-sign-in: a token it cannot verify is refused, and not echoed', async () => {
      const forged = 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuaW52YWxpZCJ9.'
      const response = await http(String(ci?.tokenExchange), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: String(ci?.grantType),
          subject_token: forged,
          subject_token_type: String(ci?.subjectTokenType),
        }).toString(),
      })
      assert(response.status === 400, `answered ${response.status}`)
      const text = await response.text()
      assert(text.includes('invalid_grant'), 'the refusal is not invalid_grant')
      assert(!text.includes(forged), 'the refusal repeats the token')
    })
  }

  // Optional: a guide for agents (story 370), named by discovery as an https address.
  const agents = state.discovery?.agents as Json | undefined
  if (agents !== undefined)
    await check("agents: discovery's guide is an https address", async () => {
      const guide = agents?.guide
      assert(typeof guide === 'string', 'agents.guide is missing')
      const url = new URL(String(guide))
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      assert(
        url.protocol === 'https:' || (url.protocol === 'http:' && local),
        `agents.guide is ${url.protocol} rather than https`,
      )
    })

  // Optional: a person signed in through a provider (story 364). Offered by
  // discovery alone, with the same endpoint and grant as CI's.
  const people = (state.discovery?.auth as Json | undefined)?.people as Json | undefined
  if (people) {
    const providers = (people.providers as Json[] | undefined) ?? []
    const exchange = (token: string) =>
      http(String(people.tokenExchange), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: String(people.grantType),
          subject_token: token,
          subject_token_type: String(people.subjectTokenType),
        }).toString(),
      })
    const refusal = async (response: Response, token: string) => {
      assert(response.status === 400, `answered ${response.status}`)
      const text = await response.text()
      assert(text.includes('invalid_grant'), 'the refusal is not invalid_grant')
      assert(!text.includes(token), 'the refusal repeats the token')
    }
    await check(
      'people: discovery names the exchange and each provider, issuer and audience',
      async () => {
        for (const field of ['tokenExchange', 'grantType', 'subjectTokenType', 'audience'])
          assert(typeof people[field] === 'string', `auth.people.${field} is missing`)
        assert(providers.length > 0, 'auth.people.providers is empty')
        for (const provider of providers)
          for (const field of ['id', 'issuer', 'audience'])
            assert(typeof provider[field] === 'string', `a provider's ${field} is missing`)
      },
    )
    await check("people: an unsigned token naming a provider's issuer is refused", async () => {
      const claims = Buffer.from(JSON.stringify({ iss: providers[0]?.issuer })).toString(
        'base64url',
      )
      const forged = `eyJhbGciOiJub25lIn0.${claims}.`
      await refusal(await exchange(forged), forged)
    })
    await check('people: a minted token signs the person in, once', async () => {
      const provider = providers[0]
      if (!options.personToken || !provider) return 'skip'
      const token = await options.personToken({
        id: String(provider.id),
        issuer: String(provider.issuer),
        audience: String(provider.audience),
      })
      const answer = await exchange(token)
      assert(answer.status === 200, `answered ${answer.status}`)
      const body = (await answer.json()) as Json
      assert(typeof body.access_token === 'string', 'no access_token')
      assert(body.token_type === 'Bearer', 'token_type is not Bearer')
      const me = await http(`${state.api}/me`, {
        headers: { authorization: `Bearer ${String(body.access_token)}` },
      })
      assert(me.status === 200, `me answered ${me.status}`)
      assert(((await me.json()) as Json).kind === 'person', 'me is not a person')
      await refusal(await exchange(token), token)
    })
  }

  await check('the API refuses a request without a token, as a problem', async () => {
    const response = await http(`${state.api}/environments`)
    assert(response.status === 401, `answered ${response.status}`)
    assert(isProblem(response), 'not application/problem+json')
  })

  // Optional: applying a bundle (story 167). A remote that takes bundles checks
  // what it is sent before anything else, and says so as a problem.
  if (capabilities.includes('bundle-apply')) {
    await check('bundle-apply: a bundle that is not the one described is refused', async () => {
      const response = await api(`environments/${state.environment}/bundles`, {
        method: 'PUT',
        headers: { 'crombolo-sha256': '0'.repeat(64), 'content-type': 'application/gzip' },
        body: new Uint8Array([31, 139, 8, 0]),
      })
      assert(response.status === 400 || response.status === 403, `answered ${response.status}`)
      assert(isProblem(response), 'not application/problem+json')
    })
  }

  await check('environments lists what the token may do', async () => {
    const response = await api('environments')
    assert(response.status === 200, `answered ${response.status}`)
    const list = (await response.json()) as Json[]
    const env = list.find((e) => e.id === state.environment)
    assert(env, `"${state.environment}" is not listed`)
    const may = env?.may as Json | undefined
    for (const field of ['pull', 'pullFull', 'push'])
      assert(typeof may?.[field] === 'boolean', `may.${field} is missing`)
    state.may = may
  })

  await check('an unknown job is not found', async () => {
    const response = await api(`jobs/${crypto.randomUUID()}`)
    assert(response.status === 404, `answered ${response.status}`)
    assert(isProblem(response), 'not application/problem+json')
  })

  await check('a pull without a passphrase is refused', async () => {
    if (!state.may?.pull) return 'skip'
    const response = await api(`environments/${state.environment}/pulls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert(response.status === 400, `answered ${response.status}`)
    assert(isProblem(response), 'not application/problem+json')
  })

  await check('a pull runs as a job and ends in a download whose hash it states', async () => {
    if (!state.may?.pull) return 'skip'
    const started = await api(`environments/${state.environment}/pulls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    })
    assert(started.status === 202, `starting answered ${started.status}`)
    const job = await settle(String(((await started.json()) as Json).id))
    assert(job.state === 'done', `the job ended ${job.state}: ${JSON.stringify(job.problem ?? {})}`)
    const download = job.download as Json | undefined
    assert(typeof download?.url === 'string', 'download.url is missing')
    const file = await http(String(download?.url), authorised())
    assert(file.status === 200, `the download answered ${file.status}`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    assert(bytes[0] === 0x1f && bytes[1] === 0x8b, 'the download is not gzip')
    assert(sha256(bytes) === download?.sha256, 'the download does not match download.sha256')
    state.pulled = { bytes, sha256: sha256(bytes) }
  })

  await check('media links answer null for a file the remote does not have', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('media-fetch') || !state.may?.pull) return 'skip'
    const response = await api(`environments/${state.environment}/media/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['conformance/not-there.png'] }),
    })
    assert(response.status === 200, `answered ${response.status}`)
    const body = (await response.json()) as { links?: Record<string, unknown> }
    assert(body.links?.['conformance/not-there.png'] === null, 'the missing file was not null')
  })

  await check('the audit log answers a page, oldest first after a cursor', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('audit') || !state.may?.audit) return 'skip'
    const response = await api(`environments/${state.environment}/audit?after=0&limit=5`)
    assert(response.status === 200, `answered ${response.status}`)
    const body = (await response.json()) as { items?: Json[]; next?: unknown; truncated?: unknown }
    assert(Array.isArray(body.items), 'items is missing')
    assert(typeof body.truncated === 'boolean', 'truncated is missing')
    const ids = (body.items ?? []).map((item) => Number(item.id))
    assert(
      ids.every((id, index) => index === 0 || id > (ids[index - 1] as number)),
      'the entries are not oldest first',
    )
    const refused = await api(`environments/${state.environment}/audit?limit=501`)
    assert(refused.status === 400, `a limit over 500 answered ${refused.status}`)
    assert(isProblem(refused), 'not application/problem+json')
  })

  await check('content-history: an unknown page and an unknown version are not found', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('content-history')) return 'skip'
    const env = `environments/${state.environment}`
    const page = await api(`${env}/content/${crypto.randomUUID()}/history`)
    assert(page.status === 404, `an unknown page's history answered ${page.status}`)
    assert(isProblem(page), 'not application/problem+json')
    const version = await api(`${env}/content/versions/999999999`)
    assert(version.status === 404, `an unknown version answered ${version.status}`)
    const rollback = await api(`${env}/content/versions/999999999/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert(
      rollback.status === 404,
      `rolling back to an unknown version answered ${rollback.status}`,
    )
  })

  await check(
    'recycle-bin: lists its items, and refuses to restore what is not in it',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('recycle-bin')) return 'skip'
      const env = `environments/${state.environment}`
      const response = await api(`${env}/recycle-bin`)
      assert(response.status === 200, `answered ${response.status}`)
      const body = (await response.json()) as { items?: Json[] }
      assert(Array.isArray(body.items), 'items is missing')
      for (const item of body.items ?? []) {
        assert(
          typeof item.key === 'string' && typeof item.name === 'string',
          'an item has no key or name',
        )
        assert(item.kind === 'content' || item.kind === 'media', `an item's kind is ${item.kind}`)
        assert(typeof item.from === 'object' && item.from !== null, 'an item has no from')
      }
      const restore = await api(`${env}/recycle-bin/${crypto.randomUUID()}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert(restore.status === 404, `restoring what is not in the bin answered ${restore.status}`)
      assert(isProblem(restore), 'not application/problem+json')
    },
  )

  await check('members: lists members, and a member who is not there is not found', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('members')) return 'skip'
    const env = `environments/${state.environment}`
    const listed = await api(`${env}/members?take=5`)
    assert(listed.status === 200, `the list answered ${listed.status}`)
    const body = (await listed.json()) as { items?: Json[]; total?: unknown }
    assert(Array.isArray(body.items), 'items is missing')
    assert(typeof body.total === 'number', 'total is missing')
    for (const member of body.items ?? [])
      assert(
        typeof member.key === 'string' && typeof member.login === 'string',
        'a member has no key or login',
      )
    const missing = await api(`${env}/members/${crypto.randomUUID()}`)
    assert(missing.status === 404, `an unknown member answered ${missing.status}`)
    assert(isProblem(missing), 'not application/problem+json')
    const groups = await api(`${env}/member-groups`)
    assert(groups.status === 200, `the groups answered ${groups.status}`)
    assert(Array.isArray(((await groups.json()) as Json).groups), 'groups is missing')
  })

  await check(
    "users: the caller's own sign-ins are listed, they are found, and a change of nothing changes nothing",
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('users')) return 'skip'
      const env = `environments/${state.environment}`
      const listed = await api(`${env}/sign-ins`)
      assert(listed.status === 200, `the sign-ins answered ${listed.status}`)
      const items = ((await listed.json()) as { items?: Json[] }).items
      assert(Array.isArray(items), 'items is missing')
      const keys = new Set((items ?? []).map((item) => (item.user as Json | undefined)?.key))
      for (const item of items ?? [])
        assert(
          typeof item.id === 'string' && (item.kind === 'browser' || item.kind === 'terminal'),
          'a sign-in has no id, or is neither a browser nor a terminal',
        )
      assert(keys.size <= 1, "the sign-ins are not all the caller's own")
      const me = [...keys][0]
      if (typeof me !== 'string') return
      const found = await api(`${env}/users?find=${encodeURIComponent(me)}`)
      // Finding and changing users needs the Users section, which the caller may not have.
      if (found.status === 403) return
      assert(found.status === 200, `finding the caller answered ${found.status}`)
      assert(((await found.json()) as Json).key === me, 'the user found is not the caller')
      const missing = await api(`${env}/users?find=${crypto.randomUUID()}`)
      assert(missing.status === 404, `an unknown user answered ${missing.status}`)
      assert(isProblem(missing), 'not application/problem+json')
      const unchanged = await api(`${env}/users/${me}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (unchanged.status === 403) return
      assert(unchanged.status === 200, `a change of nothing answered ${unchanged.status}`)
      const done = (await unchanged.json()) as Json
      assert(
        Array.isArray(done.changed) && done.changed.length === 0,
        'a change of nothing changed something',
      )
    },
  )

  await check(
    'background-jobs: lists a page of jobs, and refuses to run again one that has not failed',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('background-jobs') || !state.may?.backgroundJobs) return 'skip'
      const env = `environments/${state.environment}`
      const listed = await api(`${env}/background-jobs?take=20`)
      assert(listed.status === 200, `the list answered ${listed.status}`)
      const body = (await listed.json()) as { items?: Json[]; total?: unknown }
      assert(Array.isArray(body.items), 'items is missing')
      assert(typeof body.total === 'number', 'total is missing')
      assert('waitingSince' in body, 'waitingSince is missing')
      for (const job of body.items ?? [])
        assert(
          typeof job.id === 'string' &&
            typeof job.name === 'string' &&
            typeof job.state === 'string',
          'a job has no id, name or state',
        )
      const missing = await api(`${env}/background-jobs/${crypto.randomUUID()}/retry`, {
        method: 'POST',
      })
      // A site that takes no changes refuses any retry first.
      if (missing.status === 403 && ((await missing.json()) as Json).code === 'access-level') return
      assert(missing.status === 404, `retrying an unknown job answered ${missing.status}`)
      assert(isProblem(missing), 'not application/problem+json')
      const notFailed = (body.items ?? []).find((job) => job.state !== 'failed')
      if (!notFailed) return
      const refused = await api(`${env}/background-jobs/${notFailed.id}/retry`, { method: 'POST' })
      assert(
        refused.status === 409,
        `retrying a job that has not failed answered ${refused.status}`,
      )
      assert(isProblem(refused), 'not application/problem+json')
    },
  )

  await check(
    'extension-activity: a page, the counts and the CSV file of what an extension did',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('extension-activity') || !state.may?.extensionActivity)
        return 'skip'
      const base = `environments/${state.environment}/installed/conformance-check/activity`
      const page = await api(`${base}?limit=5`)
      assert(page.status === 200, `a page answered ${page.status}`)
      const body = (await page.json()) as { items?: unknown; next?: unknown }
      assert(Array.isArray(body.items), 'items is missing')
      assert('next' in body, 'next is missing')
      const summary = await api(`${base}/summary`)
      assert(summary.status === 200, `the summary answered ${summary.status}`)
      const counts = (await summary.json()) as {
        counts?: unknown
        people?: unknown
        days?: unknown
      }
      assert(typeof counts.counts === 'object' && counts.counts !== null, 'counts is missing')
      assert(Array.isArray(counts.people), 'people is missing')
      assert(typeof counts.days === 'number', 'days is missing')
      const csv = await api(`${base}.csv`)
      assert(csv.status === 200, `the CSV file answered ${csv.status}`)
      assert(
        (csv.headers.get('content-type') ?? '').startsWith('text/csv'),
        'the CSV file is not text/csv',
      )
      assert((await csv.text()).startsWith('when,person,kind,'), 'the CSV file has no header')
      const wrong = await api(`${base}?limit=0`)
      assert(wrong.status === 400, `a limit of 0 answered ${wrong.status}`)
      assert(isProblem(wrong), 'not application/problem+json')
    },
  )

  await check(
    'media-library: a page of media, one item shown, and a change to its name undone',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('media-library') || !state.may?.mediaLibrary) return 'skip'
      const base = `environments/${state.environment}/media-items`
      const listed = await api(`${base}?take=5`)
      assert(listed.status === 200, `the list answered ${listed.status}`)
      const page = (await listed.json()) as { items?: Json[]; total?: unknown }
      assert(Array.isArray(page.items), 'items is missing')
      assert(typeof page.total === 'number', 'total is missing')
      const missing = await api(`${base}/${crypto.randomUUID()}`)
      assert(missing.status === 404, `an unknown item answered ${missing.status}`)
      assert(isProblem(missing), 'not application/problem+json')
      const first = page.items?.[0]
      if (!first) return
      assert(
        typeof first.key === 'string' && typeof first.path === 'string',
        'an item has no key or path',
      )
      const shown = await api(`${base}/${first.key}?references=true`)
      assert(shown.status === 200, `showing an item answered ${shown.status}`)
      const item = (await shown.json()) as Json
      assert(typeof item.access === 'string', 'access is missing')
      assert(
        typeof (item.references as Json | undefined)?.total === 'number',
        'references is missing',
      )
      const rename = (name: unknown) =>
        api(`${base}/${first.key}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })
      const renamed = await rename(`${first.name} (conformance)`)
      // A site that takes no changes refuses the change first.
      if (renamed.status === 403 && ((await renamed.json()) as Json).code === 'access-level') return
      assert(renamed.status === 200, `renaming answered ${renamed.status}`)
      const undone = await rename(first.name)
      assert(undone.status === 200, `renaming it back answered ${undone.status}`)
      assert(((await undone.json()) as Json).name === first.name, 'the name was not put back')
    },
  )

  await check('media-access: who may see an item reads back, with its summary', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('media-access') || !state.may?.mediaLibrary) return 'skip'
    const base = `environments/${state.environment}/media-items`
    const missing = await api(`${base}/${crypto.randomUUID()}/access`)
    assert(missing.status === 404, `an unknown item's access answered ${missing.status}`)
    const first = (((await (await api(`${base}?take=1`)).json()) as { items?: Json[] }).items ??
      [])[0]
    if (!first) return
    const read = await api(`${base}/${first.key}/access`)
    assert(read.status === 200, `reading access answered ${read.status}`)
    const view = (await read.json()) as Json
    assert(typeof view.summary === 'string', 'summary is missing')
    assert(typeof (view.form as Json | undefined)?.inherit === 'boolean', 'form is missing')
    const wrong = await api(`${base}/${first.key}/access`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'everything' }),
    })
    if (wrong.status === 403 && ((await wrong.json()) as Json).code === 'access-level') return
    assert(wrong.status === 400, `a change it cannot read answered ${wrong.status}`)
    assert(isProblem(wrong), 'not application/problem+json')
  })

  await check(
    'content-show: a page as content show gives it, and an unknown one is not found',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('content-show') || !state.may?.contentShow) return 'skip'
      const env = `environments/${state.environment}`
      const missing = await api(`${env}/content-items/${crypto.randomUUID()}`)
      assert(missing.status === 404, `an unknown page answered ${missing.status}`)
      assert(isProblem(missing), 'not application/problem+json')
      if (!capabilities.includes('content-query')) return
      const found = await api(`${env}/content/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity: 'document', take: 1 }),
      })
      const first = (((await found.json().catch(() => ({}))) as { items?: Json[] }).items ?? [])[0]
      if (!first) return
      const shown = await api(`${env}/content-items/${first.id}?references=true`)
      assert(shown.status === 200, `showing a page answered ${shown.status}`)
      const page = (await shown.json()) as Json
      assert(
        typeof page.path === 'string' && Array.isArray(page.values),
        'path or values is missing',
      )
      assert(
        typeof (page.references as Json | undefined)?.total === 'number',
        'references is missing',
      )
    },
  )

  await check('schema-files: the schema reads as its files by path, with a version', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('schema-files') || !state.may?.pull) return 'skip'
    const response = await api(`environments/${state.environment}/schema`)
    assert(response.status === 200, `answered ${response.status}`)
    const body = (await response.json()) as { version?: unknown; files?: Record<string, unknown> }
    assert(typeof body.version === 'string', 'version is missing')
    assert(body.files !== null && typeof body.files === 'object', 'files is missing')
    assert(
      Object.values(body.files ?? {}).every((text) => typeof text === 'string'),
      'a file is not text',
    )
  })

  await check(
    'schema-edit: an edit of nothing changes nothing, and one on a stale base is refused',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('schema-edit') || !state.may?.schemaEdit) return 'skip'
      const env = `environments/${state.environment}`
      const post = (body: unknown) =>
        api(`${env}/schema/edits`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      const wrong = await post({ edits: 'nothing' })
      assert(wrong.status === 400, `a malformed edit answered ${wrong.status}`)
      assert(isProblem(wrong), 'not application/problem+json')
      const empty = await post({ edits: {} })
      // A site whose schema changes only with a deploy says so, and that is all it can say.
      if (empty.status === 409 && ((await empty.json()) as Json).code === 'not-writable') return
      assert(empty.status === 200, `an empty edit answered ${empty.status}`)
      assert(((await empty.json()) as Json).changed === false, 'an empty edit changed something')
      const files = (await (await api(`${env}/schema`)).json()) as { files: Record<string, string> }
      const [path, text] = Object.entries(files.files)[0] ?? []
      if (path === undefined) return
      const stale = await post({ edits: { [path]: text }, base: { [path]: '0'.repeat(64) } })
      assert(stale.status === 409, `a stale base answered ${stale.status}`)
      assert(((await stale.json()) as Json).code === 'changed-here', 'not changed-here')
    },
  )

  await check(
    "public-access: a page's access reads back, and an unknown page's is not found",
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('public-access')) return 'skip'
      const env = `environments/${state.environment}`
      const missing = await api(`${env}/content/${crypto.randomUUID()}/access`)
      assert(missing.status === 404, `an unknown page's access answered ${missing.status}`)
      assert(isProblem(missing), 'not application/problem+json')
      if (!capabilities.includes('content-query')) return
      const found = await api(`${env}/content/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ take: 1 }),
      })
      const page = ((await found.json()) as { items?: Json[] }).items?.[0]
      if (!page) return
      const access = await api(`${env}/content/${page.id}/access`)
      assert(access.status === 200, `a page's access answered ${access.status}`)
      const read = (await access.json()) as Json
      assert(
        read.rule === 'own' || read.rule === 'ancestor' || read.rule === 'none',
        `a page's rule is ${read.rule}`,
      )
      assert(
        (read.page as Json | undefined)?.key === page.id,
        'the access is not the page asked for',
      )
    },
  )

  await check(
    'changes: the site lists its changes, says which it holds, and gives one as a bundle with its hash',
    async () => {
      const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
      if (!capabilities.includes('changes') || !state.may?.pull) return 'skip'
      const env = `environments/${state.environment}`
      const listed = await api(`${env}/changes?take=5`)
      assert(listed.status === 200, `the list answered ${listed.status}`)
      const list = (await listed.json()) as { total?: unknown; items?: Json[] }
      assert(typeof list.total === 'number', 'total is missing')
      assert(Array.isArray(list.items), 'items is missing')
      const unknown = crypto.randomUUID()
      const held = await api(`${env}/changes/held?keys=${unknown}`)
      assert(held.status === 200, `held answered ${held.status}`)
      const heldBody = (await held.json()) as { held?: unknown }
      assert(Array.isArray(heldBody.held), 'held is missing')
      assert((heldBody.held as unknown[]).length === 0, 'it holds a change nobody made')
      const missing = await api(`${env}/changes/${unknown}/bundle`)
      assert(missing.status === 404, `an unknown change answered ${missing.status}`)
      assert(isProblem(missing), 'not application/problem+json')
      const first = list.items?.[0]
      if (!first) return
      const bundle = await api(`${env}/changes/${String(first.id)}/bundle`)
      assert(bundle.status === 200, `the bundle answered ${bundle.status}`)
      const bytes = new Uint8Array(await bundle.arrayBuffer())
      const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
      assert(bundle.headers.get('crombolo-sha256') === sha, 'Crombolo-Sha256 is not its hash')
    },
  )

  await check('changes: a change whose file does not match its hash is refused', async () => {
    if (!state.may?.applyChanges) return 'skip'
    const response = await api(`environments/${state.environment}/changes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/gzip', 'crombolo-sha256': '0'.repeat(64) },
      body: new Uint8Array([31, 139, 8, 0]) as BodyInit,
    })
    assert(response.status === 400, `answered ${response.status}`)
    assert(isProblem(response), 'not application/problem+json')
  })

  await check('a push check answers what would be recycled and removed', async () => {
    const capabilities = (state.discovery?.capabilities as string[] | undefined) ?? []
    if (!capabilities.includes('push-check') || !state.may?.push) return 'skip'
    const response = await api(`environments/${state.environment}/pushes/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodes: [], files: [] }),
    })
    assert(response.status === 200, `answered ${response.status}`)
    const body = (await response.json()) as Json
    assert(typeof body.recycles === 'object' && body.recycles !== null, 'recycles is missing')
    assert(Array.isArray(body.removesFiles), 'removesFiles is missing')
  })

  await check('a push whose file does not match its hash is refused', async () => {
    if (!state.may?.push || !state.pulled) return 'skip'
    const response = await api(`environments/${state.environment}/pushes`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/gzip',
        'crombolo-sha256': '0'.repeat(64),
        'crombolo-passphrase': passphrase,
      },
      body: state.pulled.bytes as BodyInit,
    })
    assert(response.status === 400, `answered ${response.status}`)
    assert(isProblem(response), 'not application/problem+json')
  })

  await check(
    'a push of the pulled file replaces the environment, or waits for approval',
    async () => {
      if (!options.push || !state.may?.push || !state.pulled) return 'skip'
      const response = await api(`environments/${state.environment}/pushes`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/gzip',
          'crombolo-sha256': state.pulled.sha256,
          'crombolo-passphrase': passphrase,
        },
        body: state.pulled.bytes as BodyInit,
      })
      assert(response.status === 202, `answered ${response.status}`)
      const started = (await response.json()) as Json
      if (started.state === 'approval-required') {
        assert(typeof started.approvalUrl === 'string', 'approvalUrl is missing')
        return
      }
      const job = await settle(String(started.id))
      assert(
        job.state === 'done',
        `the job ended ${job.state}: ${JSON.stringify(job.problem ?? {})}`,
      )
    },
  )

  return { passed: checks.every((c) => c.ok), checks }
}
