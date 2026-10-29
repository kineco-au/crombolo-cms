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
 * Both halves ship in one npm package. The client half is discovered from the
 * `crombolo` field once the package is a dependency; the server half runs only
 * because a site imported `redirects()` into its `crombolo.config.ts` — see
 * `docs/bundles.md` for why that asymmetry is the whole security story.
 */
import {
  type BundleRedirectInput,
  type BundleRouteContext,
  type BundleSection,
  route,
  type ServerBundle,
} from '@crombolo/crombolo/bundle'
import manifest from '../package.json' with { type: 'json' }

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
