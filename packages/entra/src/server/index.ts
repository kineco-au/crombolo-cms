/**
 * The Microsoft Entra bundle (story 033): a Settings screen for the Entra sign-ins
 * a site declares in code with `entra()`. It changes their settings — tenant, app
 * credentials, the sign-in options and group mappings — and puts them back; it
 * never declares a provider. The overrides live in core, behind the
 * `identityProviders` capability, and apply at the next sign-in on every node.
 *
 * Reading is for anyone with the Settings section. Changing is for
 * administrators only, because a group mapping can make someone an administrator.
 */
import {
  type BundleIdentityProviders,
  type BundleRouteContext,
  type BundleScreenContext,
  type BundleSection,
  button,
  cell,
  empty,
  type Field,
  field,
  form,
  notice,
  type ProviderOverrideInput,
  problem,
  type RouteContext,
  route,
  row,
  type ScreenResult,
  type ServerBundle,
  screen,
  tab,
  table,
  tabs,
} from '@crombolo/extension'
import manifest from '../../package.json' with { type: 'json' }

const CAPABILITIES = ['identityProviders', 'log'] as const

type Capability = (typeof CAPABILITIES)[number]

export const ENTRA_BUNDLE_ID = manifest.crombolo.id

export interface EntraSettingsOptions {
  /** The section a caller must have to see the screen; Settings by default. */
  section?: BundleSection
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const AUDIENCES = new Set(['member', 'user'])

/** The fields the screen sends, each checked for its type; nothing else is passed on. */
export function readOverrides(body: Record<string, unknown>): ProviderOverrideInput {
  const out: ProviderOverrideInput = {}
  for (const field of ['name', 'tenantId', 'clientId'] as const)
    if (field in body && (typeof body[field] === 'string' || body[field] === null))
      out[field] = (body[field] as string | null)?.trim() || undefined
  if ('clientSecret' in body) {
    const secret = body.clientSecret
    if (secret === null) out.clientSecret = null
    else if (typeof secret === 'string' && secret.trim()) out.clientSecret = secret.trim()
  }
  for (const field of ['autoCreate', 'linkByEmail', 'emailsVerified'] as const)
    if (field in body) out[field] = typeof body[field] === 'boolean' ? body[field] : undefined
  if ('groupMap' in body) {
    const map = body.groupMap
    if (map === null) out.groupMap = undefined
    else if (map && typeof map === 'object' && !Array.isArray(map)) {
      const entries = Object.entries(map as Record<string, unknown>)
        .filter(([key, value]) => key.trim() && typeof value === 'string' && value.trim())
        .map(([key, value]) => [key.trim(), (value as string).trim()])
      out.groupMap = Object.fromEntries(entries)
    }
  }
  if ('defaultGroups' in body) {
    const groups = body.defaultGroups
    out.defaultGroups = Array.isArray(groups)
      ? groups
          .filter((g): g is string => typeof g === 'string' && g.trim() !== '')
          .map((g) => g.trim())
      : undefined
  }
  return out
}

const parseBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body = await request.json().catch(() => undefined)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

type Context = RouteContext & BundleRouteContext<Capability>

/** The provider a route names, when it is an Entra one the config declares. */
async function entraProvider(context: Context) {
  const { audience, id } = context.params
  if (!audience || !AUDIENCES.has(audience)) return undefined
  const all = await context.bundle.identityProviders.list()
  return all.find((p) => p.kind === 'entra' && p.audience === audience && p.id === id)
}

const adminOnly = () =>
  json({ ok: false, message: 'Only an administrator can change how people sign in.' }, 403)

const AUDIENCE_NAMES: Record<string, string> = { user: 'Backoffice users', member: 'Members' }

type Provider = Awaited<ReturnType<BundleIdentityProviders['list']>>[number]
type SignInContext = BundleScreenContext<Capability>

const ADMIN_ONLY = 'Only an administrator can change how people sign in.'

/** A field's hint when an administrator changed it here rather than in the code. */
const changedHere = (provider: Provider, name: string) =>
  provider.overridden.includes(name) ? 'Changed here, not in the code.' : undefined

/** Why a sign-in cannot be changed here, when it is locked (story 305). */
const lockedBecause = (provider: Provider) =>
  provider.locked === 'config'
    ? "Locked by the site's configuration: it signs in by the code alone."
    : provider.locked === 'environment'
      ? "Locked by the server's settings: it signs in by the code alone."
      : undefined

/** One sign-in's form: what is in force, read-only for anyone but an administrator. */
function providerForm(
  provider: Provider,
  groups: Array<{ value: string; name: string }>,
  isAdmin: boolean,
) {
  const lock = lockedBecause(provider)
  const canEdit = isAdmin && !lock
  const readOnly = !canEdit
  const hinted = (name: string, options: Record<string, unknown> = {}) => {
    const hint = lock ?? changedHere(provider, name)
    return { readOnly, ...(hint ? { hint } : {}), ...options }
  }
  const fields: Field[] = [
    field.text('name', 'Button text', hinted('name')),
    field.text('tenantId', 'Tenant ID', hinted('tenantId')),
    field.text('clientId', 'Application (client) ID', hinted('clientId')),
    field.secret('clientSecret', 'Client secret', {
      readOnly,
      hint: provider.missingSecret
        ? 'This sign-in goes somewhere the code did not name, so it needs its own secret. Enter it to sign people in again.'
        : provider.hasClientSecret
          ? 'A secret is set. Enter a new one to replace it.'
          : 'No secret is set.',
    }),
    field.boolean('autoCreate', 'Create accounts', hinted('autoCreate')),
    field.boolean('linkByEmail', 'Link by email', hinted('linkByEmail')),
    field.boolean('emailsVerified', 'Trust emails', hinted('emailsVerified')),
    field.list(
      'mappings',
      'Group mappings',
      [
        field.text('claim', 'Entra group object ID', { required: true }),
        field.choice(
          'group',
          'Group here',
          groups.map((group) => ({ value: group.value, label: group.name })),
          { required: true },
        ),
      ],
      hinted('groupMap', {
        addLabel: 'Add a mapping',
        hint: "An Entra group's object ID, and the group here its members join. Made to match on every sign-in.",
      }),
    ),
    // One per group, as the default groups are a set.
    ...groups.map((group) =>
      field.boolean(`default.${group.value}`, `Default group: ${group.name}`, { readOnly }),
    ),
  ]
  const key = { audience: provider.audience, id: provider.id }
  const actions = [
    ...(canEdit
      ? [button('Save', 'save', { submit: true, look: 'primary' as const, input: key })]
      : []),
    button('Test connection', 'test', { input: key }),
    ...(isAdmin && (canEdit ? provider.overridden : provider.ignored).length > 0
      ? [
          button(lock ? 'Clear the changes it ignores' : "Use the code's settings", 'reset', {
            input: key,
            look: 'danger' as const,
            confirm: lock
              ? `Clear the changes made here before it was locked (${provider.ignored.join(', ')})? It signs in by the code either way.`
              : `Put the ${AUDIENCE_NAMES[provider.audience]} sign-in back to what the code says? Every change made here goes.`,
          }),
        ]
      : []),
    ...(canEdit && provider.overridden.includes('clientSecret')
      ? [button('Remove the secret kept here', 'removeSecret', { input: key })]
      : []),
  ]
  return form(
    fields,
    {
      name: provider.name,
      tenantId: provider.tenantId ?? '',
      clientId: provider.clientId,
      autoCreate: provider.autoCreate,
      linkByEmail: provider.linkByEmail,
      emailsVerified: provider.emailsVerified,
      mappings: Object.entries(provider.groupMap).map(([claim, group]) => ({ claim, group })),
      ...Object.fromEntries(
        groups.map((group) => [
          `default.${group.value}`,
          provider.defaultGroups.includes(group.value),
        ]),
      ),
    },
    actions,
  )
}

/** The whole screen: a tab per Entra sign-in the site declares, or what to do without one. */
async function signInScreen(
  context: SignInContext,
  said?: { notice?: string; problem?: string },
): Promise<ScreenResult> {
  const host = context.bundle.identityProviders
  const providers = (await host.list()).filter((p) => p.kind === 'entra')
  const canEdit = context.principal?.isAdmin === true
  const body = []
  if (said?.problem) body.push(problem(said.problem))
  if (!canEdit) body.push(notice(ADMIN_ONLY))
  if (providers.length === 0)
    body.push(
      empty('No Entra sign-in', {
        text: "The site's code declares Entra sign-ins with entra(); this screen changes their settings.",
      }),
    )
  else
    body.push(
      tabs(
        await Promise.all(
          providers.map(async (provider) =>
            tab(
              `${provider.audience}-${provider.id}`,
              `${AUDIENCE_NAMES[provider.audience]} — ${provider.name}`,
              [
                ...(provider.missingSecret
                  ? [
                      problem(
                        `${provider.name} signs nobody in: it goes somewhere the code did not name, without a secret of its own.`,
                      ),
                    ]
                  : []),
                table(
                  ['Redirect URL to register in Entra, after the site’s address'],
                  [row('callback', [cell.code(provider.callbackPath)])],
                ),
                providerForm(provider, await host.groups(provider.audience), canEdit),
              ],
            ),
          ),
        ),
      ),
    )
  return {
    screen: screen('Microsoft Entra', body),
    ...(said?.notice ? { notice: said.notice } : {}),
  }
}

/** The provider an action names, when it is an Entra one the site declares. */
async function namedProvider(context: SignInContext): Promise<Provider | undefined> {
  const { audience, id } = context.input as { audience?: string; id?: string }
  return (await context.bundle.identityProviders.list()).find(
    (p) => p.kind === 'entra' && p.audience === audience && p.id === id,
  )
}

/** The form's values as the overrides `readOverrides` takes. */
function overridesFrom(values: Record<string, unknown>): ProviderOverrideInput {
  const mappings = Array.isArray(values.mappings) ? values.mappings : []
  return readOverrides({
    name: values.name,
    tenantId: values.tenantId,
    clientId: values.clientId,
    ...('clientSecret' in values ? { clientSecret: values.clientSecret } : {}),
    autoCreate: values.autoCreate,
    linkByEmail: values.linkByEmail,
    emailsVerified: values.emailsVerified,
    groupMap: Object.fromEntries(
      mappings.map((m: { claim?: unknown; group?: unknown }) => [
        String(m.claim ?? ''),
        String(m.group ?? ''),
      ]),
    ),
    defaultGroups: Object.entries(values)
      .filter(([key, on]) => key.startsWith('default.') && on === true)
      .map(([key]) => key.slice('default.'.length)),
  })
}

/** Runs an administrator's change on the named sign-in, and answers the screen with what happened. */
const change =
  (run: (context: SignInContext, provider: Provider) => Promise<string | { problem: string }>) =>
  async (context: SignInContext) => {
    if (context.principal?.isAdmin !== true) return signInScreen(context, { problem: ADMIN_ONLY })
    const provider = await namedProvider(context)
    if (!provider) return signInScreen(context, { problem: 'There is no such Entra sign-in.' })
    const said = await run(context, provider)
    return signInScreen(context, typeof said === 'string' ? { notice: said } : said)
  }

/** The Entra screen (story 329), described for the back office to draw. */
const signInHandlers = {
  view: (context: SignInContext) => signInScreen(context),
  actions: {
    save: change(async (context, provider) => {
      const values = (context.input.values ?? {}) as Record<string, unknown>
      const outcome = await context.bundle.identityProviders.update(
        provider.audience,
        provider.id,
        overridesFrom(values),
      )
      if (!outcome.ok) return { problem: outcome.error }
      context.bundle.log.info('{user} changed the {audience} Entra sign-in {id}', {
        user: context.principal?.email,
        audience: provider.audience,
        id: provider.id,
      })
      return 'Saved. It applies at the next sign-in.'
    }),
    reset: change(async (context, provider) => {
      await context.bundle.identityProviders.reset(provider.audience, provider.id)
      context.bundle.log.info('{user} put the {audience} Entra sign-in {id} back to the code', {
        user: context.principal?.email,
        audience: provider.audience,
        id: provider.id,
      })
      return "Put back to the code's settings."
    }),
    removeSecret: change(async (context, provider) => {
      const outcome = await context.bundle.identityProviders.update(
        provider.audience,
        provider.id,
        {
          clientSecret: null,
        },
      )
      return outcome.ok ? 'Client secret removed.' : { problem: outcome.error }
    }),
    async test(context: SignInContext) {
      const provider = await namedProvider(context)
      if (!provider) return signInScreen(context, { problem: 'There is no such Entra sign-in.' })
      const result = await context.bundle.identityProviders.test(provider.audience, provider.id)
      return signInScreen(
        context,
        result.ok ? { notice: result.message } : { problem: result.message },
      )
    },
  },
}

/** The Entra settings screen's server half, for `bundles: [entraSettings()]` in `crombolo.config.ts`. */
export function entraSettings(options: EntraSettingsOptions = {}): ServerBundle<Capability> {
  return {
    id: ENTRA_BUNDLE_ID,
    section: options.section ?? 'settings',
    capabilities: CAPABILITIES,
    screens: { 'sign-in': signInHandlers } as unknown as ServerBundle<Capability>['screens'],
    // Back-office routes (story 211), behind the user and the section.
    routes: [
      route<unknown, unknown, BundleRouteContext<Capability>>(
        'providers',
        {
          async GET(_request, { bundle, principal }) {
            const providers = (await bundle.identityProviders.list()).filter(
              (p) => p.kind === 'entra',
            )
            return json({ canEdit: principal?.isAdmin === true, providers })
          },
        },
        { audience: 'backoffice' },
      ),
      route<unknown, unknown, BundleRouteContext<Capability>>(
        'groups/:audience',
        {
          async GET(_request, { bundle, params }) {
            if (!params.audience || !AUDIENCES.has(params.audience))
              return json({ ok: false, message: 'Groups are for members or users.' }, 404)
            return json({
              groups: await bundle.identityProviders.groups(params.audience as 'member' | 'user'),
            })
          },
        },
        { audience: 'backoffice' },
      ),
      route<unknown, unknown, BundleRouteContext<Capability>>(
        'providers/:audience/:id',
        {
          async PUT(request, context) {
            if (!context.principal?.isAdmin) return adminOnly()
            const provider = await entraProvider(context as Context)
            if (!provider)
              return json({ ok: false, message: 'There is no such Entra sign-in.' }, 404)
            const outcome = await context.bundle.identityProviders.update(
              provider.audience,
              provider.id,
              readOverrides(await parseBody(request)),
            )
            if (!outcome.ok) return json({ ok: false, message: outcome.error }, 400)
            context.bundle.log.info('{user} changed the {audience} Entra sign-in {id}', {
              user: context.principal.email,
              audience: provider.audience,
              id: provider.id,
            })
            return json({ ok: true, provider: await entraProvider(context as Context) })
          },
          async DELETE(_request, context) {
            if (!context.principal?.isAdmin) return adminOnly()
            const provider = await entraProvider(context as Context)
            if (!provider)
              return json({ ok: false, message: 'There is no such Entra sign-in.' }, 404)
            await context.bundle.identityProviders.reset(provider.audience, provider.id)
            context.bundle.log.info(
              '{user} put the {audience} Entra sign-in {id} back to the code',
              {
                user: context.principal.email,
                audience: provider.audience,
                id: provider.id,
              },
            )
            return json({ ok: true, provider: await entraProvider(context as Context) })
          },
        },
        { audience: 'backoffice' },
      ),
      route<unknown, unknown, BundleRouteContext<Capability>>(
        'providers/:audience/:id/test',
        {
          async POST(_request, context) {
            const provider = await entraProvider(context as Context)
            if (!provider)
              return json({ ok: false, message: 'There is no such Entra sign-in.' }, 404)
            return json(await context.bundle.identityProviders.test(provider.audience, provider.id))
          },
        },
        { audience: 'backoffice' },
      ),
    ],
  }
}
