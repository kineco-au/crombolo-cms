/**
 * The redirects bundle: an administrator managing redirect rules in the
 * backoffice, which is what the Umbraco redirect packages add over Umbraco's own
 * Redirect URL Management dashboard.
 *
 * The engine is not here. Matching, the URL tracker and the `redirect_url` table
 * are core (`render/src/redirects.ts`, `server/src/redirects.ts`), and rules a
 * rename records or the site's config declares already work without this bundle.
 * What this adds is the third kind: a rule somebody typed, stored as `manual`.
 *
 * Its screen is described, not shipped (stories 323, 329): `screens.rules`
 * answers the table, the filter and the editor as data, and the back office
 * draws them, so no code of this package runs in the page.
 */
import {
  type BundleRedirectInput,
  type BundleRouteContext,
  type BundleScreenContext,
  type BundleSection,
  button,
  type Cell,
  cell,
  empty,
  field,
  form,
  problem,
  type Row,
  route,
  row,
  type Screen,
  type ScreenResult,
  type ServerBundle,
  screen,
  search,
  table,
} from '@crombolo/extension'
import manifest from '../../package.json' with { type: 'json' }

/** What this bundle asks the host for, and all it can reach. */
const CAPABILITIES = ['redirects', 'documents', 'log'] as const

type Capability = (typeof CAPABILITIES)[number]

type Host = BundleRouteContext<Capability>['bundle']

/** The URL segment the endpoints answer below, and the name in the log: the package's `crombolo.id`. */
export const REDIRECTS_BUNDLE_ID = manifest.crombolo.id

export interface RedirectsBundleOptions {
  /**
   * The section a caller must have access to. Settings by default, matching
   * where the screen appears; a site that lets editors manage redirects can
   * point this at `content` and move the menu item to match.
   */
  section?: BundleSection
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** The fields the screen sends, taken one at a time so nothing else is trusted. */
function readInput(body: Record<string, unknown>): BundleRedirectInput {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    matchKind: text(body.matchKind) as BundleRedirectInput['matchKind'],
    pattern: text(body.pattern),
    rootKey: text(body.rootKey) || null,
    culture: text(body.culture) || null,
    targetKind: text(body.targetKind) as BundleRedirectInput['targetKind'],
    target: text(body.target),
    statusCode: Number(body.statusCode ?? 301),
    sortOrder: Number(body.sortOrder ?? 0),
  }
}

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body = await request.json().catch(() => undefined)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

/**
 * A rule as the screen reads it. `destinationUrl` is resolved for a document
 * target so the table never shows a stale URL, exactly as the Management API's
 * own redirect listing does.
 */
async function present(
  rule: Awaited<ReturnType<Host['redirects']['byKey']>>,
  documents: Host['documents'],
) {
  if (!rule) return undefined
  return {
    key: rule.key,
    source: rule.source,
    editable: rule.editable,
    matchKind: rule.matchKind,
    pattern: rule.pattern,
    rootKey: rule.rootKey,
    culture: rule.culture,
    targetKind: rule.targetKind,
    target: rule.target,
    statusCode: rule.statusCode,
    sortOrder: rule.sortOrder,
    created: rule.createDate.toISOString(),
    destinationUrl:
      rule.targetKind === 'document' ? await documents.url(rule.target, rule.culture) : rule.target,
  }
}

const MATCH_KINDS = [
  { value: 'exact', label: 'Exactly this URL' },
  { value: 'prefix', label: 'This URL and everything below it' },
  { value: 'regex', label: 'A regular expression' },
]
const TARGET_KINDS = [
  { value: 'document', label: 'A page on this site' },
  { value: 'path', label: 'A path on this site' },
  { value: 'url', label: 'Another site' },
]
const STATUS_CODES = [
  { value: '301', label: '301 — moved permanently' },
  { value: '302', label: '302 — found, temporarily' },
  { value: '307', label: '307 — temporary, keeping the method' },
  { value: '308', label: '308 — permanent, keeping the method' },
]
const SOURCES: Record<string, { label: string; look: 'primary' | 'secondary' | 'default' }> = {
  manual: { label: 'Added here', look: 'primary' },
  config: { label: 'In configuration', look: 'secondary' },
  tracked: { label: 'From a rename', look: 'default' },
}

type Presented = NonNullable<Awaited<ReturnType<typeof present>>>

/** What the screen keeps between calls: the search, and the rule open in the editor. */
interface RulesState {
  query?: string
  editing?: { key?: string; values: Record<string, unknown> }
  problem?: string
}

/** What a visitor would have typed: the pattern and how it matches. */
const fromOf = (rule: Presented) =>
  rule.matchKind === 'prefix'
    ? `${rule.pattern === '/' ? '' : rule.pattern}/*`
    : rule.matchKind === 'regex'
      ? `/${rule.pattern}/`
      : rule.pattern

const toOf = (rule: Presented) =>
  rule.targetKind === 'document'
    ? rule.destinationUrl || 'a page that is not published'
    : rule.target

const BLANK = {
  matchKind: 'exact',
  pattern: '',
  targetKind: 'document',
  page: '',
  target: '',
  statusCode: '301',
  culture: '',
}

/** A rule as the editor's values: its target in the page field or the text field. */
const valuesOf = (rule: Presented) => ({
  matchKind: rule.matchKind,
  pattern: rule.pattern,
  targetKind: rule.targetKind,
  page: rule.targetKind === 'document' ? rule.target : '',
  target: rule.targetKind === 'document' ? '' : rule.target,
  statusCode: String(rule.statusCode),
  culture: rule.culture ?? '',
})

/** The editor's values as the capability takes them. */
const inputOf = (values: Record<string, unknown>): BundleRedirectInput =>
  readInput({
    ...values,
    target: values.targetKind === 'document' ? values.page : values.target,
  })

const editor = (editing: NonNullable<RulesState['editing']>) =>
  form(
    [
      field.choice('matchKind', 'Match', MATCH_KINDS),
      field.text('pattern', 'Redirect from', {
        required: true,
        placeholder: '/old-page',
        hints: [
          {
            when: { field: 'matchKind', equals: 'regex' },
            text: 'Captures are available in the target as $1 to $9.',
          },
          {
            when: { field: 'matchKind', equals: 'prefix' },
            text: 'Everything below this path is matched; the remainder is available as $1.',
          },
        ],
      }),
      field.choice('targetKind', 'Redirect to', TARGET_KINDS),
      field.page('page', 'Page', {
        required: true,
        visibleWhen: { field: 'targetKind', equals: 'document' },
        hint: 'A page keeps working as a target when it is renamed or moved, because the rule names the page rather than its URL.',
      }),
      field.text('target', 'Path or URL', {
        required: true,
        placeholder: '/new-page',
        visibleWhen: { field: 'targetKind', oneOf: ['path', 'url'] },
      }),
      field.choice('statusCode', 'Status code', STATUS_CODES),
      field.text('culture', 'Culture', {
        placeholder: 'Every culture',
        hint: 'Leave this empty to redirect whichever language the URL resolved in.',
      }),
    ],
    { ...BLANK, ...editing.values } as never,
    [
      button(editing.key ? 'Save' : 'Add redirect', 'save', { submit: true, look: 'primary' }),
      button('Cancel', 'cancel'),
    ],
    { title: editing.key ? 'Edit redirect' : 'Add a redirect' },
  )

/** The rule's row: what it is, where it goes, and Edit and Delete where it may be changed here. */
const ruleRow = (rule: Presented): Row => {
  const source = SOURCES[rule.source] ?? { label: rule.source, look: 'default' as const }
  const cells: Cell[] = [
    cell.code(fromOf(rule)),
    cell.code(rule.culture ? `${toOf(rule)} (${rule.culture})` : toOf(rule)),
    cell.text(String(rule.statusCode)),
    cell.tag(source.label, source.look),
  ]
  return row(
    rule.key,
    cells,
    rule.editable
      ? [
          button('Edit', 'edit', { input: { key: rule.key } }),
          button('Delete', 'remove', {
            input: { key: rule.key },
            look: 'danger',
            confirm: `Delete the redirect from ${fromOf(rule)}?`,
          }),
        ]
      : [],
  )
}

/** The whole screen, for a state. */
async function rulesScreen(host: Host, state: RulesState): Promise<Screen> {
  const result = await host.redirects.list({ filter: state.query || undefined, skip: 0, take: 500 })
  const rules = (
    await Promise.all(result.items.map((rule) => present(rule, host.documents)))
  ).filter((rule): rule is Presented => rule !== undefined)
  return screen(
    'Redirects',
    [
      ...(state.problem ? [problem(state.problem)] : []),
      ...(state.editing ? [editor(state.editing)] : []),
      rules.length === 0
        ? empty(state.query ? 'No redirect matches' : 'No redirects yet', {
            text: state.query
              ? 'Nothing redirects from or to that.'
              : 'Nothing redirects on this site. Add a rule here, or rename a published page, which records one by itself so the old URL keeps working.',
          })
        : table(['From', 'To', 'Status', 'Source'], rules.map(ruleRow)),
    ],
    {
      toolbar: [
        search('find', { placeholder: 'Search either URL', value: state.query ?? '' }),
        button('Add redirect', 'add', { look: 'primary' }),
      ],
    },
  )
}

type RulesContext = BundleScreenContext<Capability>

const answer = async (
  context: RulesContext,
  state: RulesState,
  notice?: string,
): Promise<ScreenResult> => ({
  screen: await rulesScreen(context.bundle as Host, state),
  state: { query: state.query, editing: state.editing } as Record<string, unknown>,
  ...(notice ? { notice } : {}),
})

const stateOf = (context: RulesContext): RulesState => context.state as RulesState

/** The Redirects screen (story 329): the table, the filter and the editor, as data. */
const rulesScreenHandlers = {
  view: (context: RulesContext) => answer(context, stateOf(context)),
  actions: {
    find: (context: RulesContext) =>
      answer(context, { ...stateOf(context), query: String(context.input.query ?? '') }),
    add: (context: RulesContext) =>
      answer(context, { ...stateOf(context), editing: { values: { ...BLANK } } }),
    cancel: (context: RulesContext) => answer(context, { query: stateOf(context).query }),
    async edit(context: RulesContext) {
      const bundle = context.bundle as Host
      const rule = await present(
        await bundle.redirects.byKey(String(context.input.key ?? '')),
        bundle.documents,
      )
      if (!rule)
        return answer(context, { ...stateOf(context), problem: 'That redirect no longer exists.' })
      return answer(context, {
        query: stateOf(context).query,
        editing: { key: rule.key, values: valuesOf(rule) },
      })
    },
    async save(context: RulesContext) {
      const bundle = context.bundle as Host
      const state = stateOf(context)
      const values = (context.input.values ?? {}) as Record<string, unknown>
      const key = state.editing?.key
      const outcome = key
        ? await bundle.redirects.replace(key, inputOf(values))
        : await bundle.redirects.save(inputOf(values))
      // A refusal keeps the editor open with what was typed, and says why above it.
      if (!outcome.ok)
        return answer(context, {
          query: state.query,
          editing: { ...(key ? { key } : {}), values },
          problem: outcome.message,
        })
      bundle.log.info('{user} {action} the redirect {pattern} -> {target}', {
        user: context.principal?.email,
        action: key ? 'changed' : 'added',
        pattern: outcome.rule.pattern,
        target: outcome.rule.target,
      })
      return answer(context, { query: state.query }, key ? 'Redirect updated.' : 'Redirect added.')
    },
    async remove(context: RulesContext) {
      const bundle = context.bundle as Host
      const outcome = await bundle.redirects.remove(String(context.input.key ?? ''))
      const state = { query: stateOf(context).query }
      if (outcome === 'notFound')
        return answer(context, { ...state, problem: 'That redirect no longer exists.' })
      if (outcome === 'notEditable')
        return answer(context, {
          ...state,
          problem:
            'Only a redirect added here can be deleted here. A configured rule belongs to the site, and a tracked one to the page that was renamed.',
        })
      bundle.log.info('{user} deleted a redirect', { user: context.principal?.email })
      return answer(context, state, 'Redirect deleted.')
    },
  },
}

/**
 * The bundle a site wires into `defineConfig({ bundles: [redirects()] })`.
 *
 * Every route is gated on the declared section by the host, so there is no
 * authorisation logic here to get wrong.
 */
export function redirects(options: RedirectsBundleOptions = {}): ServerBundle<Capability> {
  const section = options.section ?? 'settings'

  return {
    id: REDIRECTS_BUNDLE_ID,
    section,
    capabilities: CAPABILITIES,
    screens: { rules: rulesScreenHandlers } as unknown as ServerBundle<Capability>['screens'],
    // Back-office routes (story 211): the screen calls them below the bundle's
    // namespace, and the host has checked the user and the section first.
    routes: [
      route<unknown, unknown, BundleRouteContext<Capability>>(
        'rules',
        {
          async GET(_request, { url, bundle }) {
            const take = Math.min(Math.max(Number(url.searchParams.get('take') ?? 100), 1), 500)
            const skip = Math.max(Number(url.searchParams.get('skip') ?? 0), 0)
            const result = await bundle.redirects.list({
              filter: url.searchParams.get('filter') ?? undefined,
              skip,
              take,
            })
            return json({
              total: result.total,
              items: await Promise.all(result.items.map((rule) => present(rule, bundle.documents))),
            })
          },
          async POST(request, { principal, bundle }) {
            const outcome = await bundle.redirects.save(readInput(await parseBody(request)))
            if (!outcome.ok) return json({ ok: false, message: outcome.message }, 400)
            bundle.log.info('{user} added the redirect {pattern} -> {target}', {
              user: principal?.email,
              pattern: outcome.rule.pattern,
              target: outcome.rule.target,
            })
            return json({ ok: true, rule: await present(outcome.rule, bundle.documents) })
          },
        },
        { audience: 'backoffice' },
      ),
      route<unknown, unknown, BundleRouteContext<Capability>>(
        'rules/:key',
        {
          async PUT(request, { params, principal, bundle }) {
            const outcome = await bundle.redirects.replace(
              params.key as string,
              readInput(await parseBody(request)),
            )
            if (!outcome.ok)
              return json(
                { ok: false, message: outcome.message },
                outcome.reason === 'notFound' ? 404 : outcome.reason === 'notEditable' ? 409 : 400,
              )
            bundle.log.info('{user} changed the redirect {pattern} -> {target}', {
              user: principal?.email,
              pattern: outcome.rule.pattern,
              target: outcome.rule.target,
            })
            return json({ ok: true, rule: await present(outcome.rule, bundle.documents) })
          },
          async DELETE(_request, { params, principal, bundle }) {
            const outcome = await bundle.redirects.remove(params.key as string)
            if (outcome === 'notFound')
              return json({ ok: false, message: 'That redirect no longer exists.' }, 404)
            if (outcome === 'notEditable')
              return json(
                {
                  ok: false,
                  message:
                    'Only a redirect added here can be deleted here. A configured rule belongs to the site, and a tracked one to the page that was renamed.',
                },
                409,
              )
            bundle.log.info('{user} deleted a redirect', { user: principal?.email })
            return json({ ok: true })
          },
        },
        { audience: 'backoffice' },
      ),
    ],
  }
}
