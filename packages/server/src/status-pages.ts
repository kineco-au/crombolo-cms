/**
 * The pages that answer a status a page's code ends with (story 206): a page in
 * the content tree named by path in `pages`, rendered at the address asked for,
 * else a generic page for the status. docs/rendering.md, "Status pages".
 */
import {
  escapeHtml,
  type PageOutcome,
  type PublishedCache,
  type PublishedContent,
} from '@crombolo/render'
import type { StatusPage, StatusPageRule, StatusPagesConfig } from './config.ts'

export type StatusPageKind = keyof StatusPagesConfig

/** Which configured page answers a status: 404 and 401 their own, the rest the error page. */
export function statusPageKind(status: number): StatusPageKind {
  if (status === 404) return 'notFound'
  if (status === 401) return 'unauthorized'
  return 'error'
}

/** A configured page as rules, the bare path standing for one that matches everything. Pure. */
export function statusPageRules(page: StatusPage | undefined): StatusPageRule[] {
  if (page === undefined) return []
  if (typeof page === 'string') return page.trim() ? [{ path: page.trim() }] : []
  return page.filter((rule) => typeof rule?.path === 'string' && rule.path.trim())
}

/** The most specific rule for a request: hostname and language, then either, then neither. Pure. */
export function chooseStatusPageRule(
  rules: readonly StatusPageRule[],
  host: string,
  culture: string | null,
): StatusPageRule | undefined {
  const bare = host.toLowerCase().replace(/:\d+$/, '')
  const hostMatches = (r: StatusPageRule) =>
    r.host === undefined || [bare, host.toLowerCase()].includes(r.host.trim().toLowerCase())
  const cultureMatches = (r: StatusPageRule) =>
    r.culture === undefined || r.culture.toLowerCase() === (culture ?? '').toLowerCase()
  const score = (r: StatusPageRule) => (r.host ? 2 : 0) + (r.culture ? 1 : 0)
  return rules
    .filter((r) => hostMatches(r) && cultureMatches(r))
    .sort((a, b) => score(b) - score(a))[0]
}

/**
 * The configured page for a status on this request, in the request's culture;
 * undefined when none is configured or its path resolves to nothing.
 */
export async function resolveStatusPage(
  cache: PublishedCache,
  pages: StatusPagesConfig | undefined,
  kind: StatusPageKind,
  host: string,
  pathname: string,
): Promise<{ content: PublishedContent; culture: string | null } | undefined> {
  const rules = statusPageRules(pages?.[kind])
  if (rules.length === 0) return undefined
  const culture = await cache.cultureFor(host, pathname)
  const rule = chooseStatusPageRule(rules, host, culture)
  if (!rule) return undefined
  const resolved = await cache.resolve(host, rule.path)
  if (!resolved) return undefined
  const localised = culture ? await cache.byKey(resolved.content.key, culture) : undefined
  return localised
    ? { content: localised, culture }
    : { content: resolved.content, culture: resolved.culture }
}

/** Each configured path that resolves to nothing on any hostname, for the boot to warn about. */
export async function unresolvedStatusPages(
  cache: PublishedCache,
  pages: StatusPagesConfig | undefined,
): Promise<Array<{ kind: StatusPageKind; path: string }>> {
  const missing: Array<{ kind: StatusPageKind; path: string }> = []
  for (const kind of ['notFound', 'unauthorized', 'error'] as const)
    for (const rule of statusPageRules(pages?.[kind]))
      if (!(await cache.resolve(rule.host ?? '', rule.path)))
        missing.push({ kind, path: rule.path })
  return missing
}

const HEADINGS: Record<number, string> = {
  400: 'This request could not be used',
  401: 'Please sign in',
  403: 'You do not have access to this page',
  404: 'Page not found',
  410: 'This page is no longer available',
  422: 'Some details need correcting',
  500: 'Something went wrong',
}

/** A page for a status when the site has none of its own, or its own failed. Pure. */
export function genericStatusPage(outcome: PageOutcome): string {
  const heading = HEADINGS[outcome.status] ?? 'Something went wrong'
  const parts = [`<h1>${escapeHtml(heading)}</h1>`]
  if (outcome.message) parts.push(`<p>${escapeHtml(outcome.message)}</p>`)
  if (outcome.errors.length > 0)
    parts.push(
      `<ul>${outcome.errors
        .map((e) => `<li><strong>${escapeHtml(e.field)}</strong>: ${escapeHtml(e.message)}</li>`)
        .join('')}</ul>`,
    )
  if (outcome.details) {
    const { message, location, code, components, stack } = outcome.details
    parts.push(`<p>${escapeHtml(message)}</p>`)
    if (location) parts.push(`<p><code>${escapeHtml(location)}</code></p>`)
    if (code) parts.push(codeFrame(code))
    if (components?.length)
      parts.push(`<p>While rendering <code>${escapeHtml(components.join(' › '))}</code></p>`)
    if (stack) parts.push(`<pre>${escapeHtml(stack)}</pre>`)
  }
  if (outcome.reference)
    parts.push(`<p>Reference: <code>${escapeHtml(outcome.reference)}</code></p>`)
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title><style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}pre{overflow:auto;background:#f4f4f4;padding:1rem;font-size:.85rem}.code span{display:block}.code .at{background:#fde2e2;font-weight:600}</style></head><body><main>${parts.join('')}</main></body></html>`
}

/** The lines around a failing one, numbered, that line marked. */
function codeFrame(code: NonNullable<PageOutcome['details']>['code'] & object): string {
  const width = String(code.lines.at(-1)?.number ?? code.line).length
  const rows = code.lines.map(({ number, text }) => {
    const mark = number === code.line ? '>' : ' '
    const label = `${mark} ${String(number).padStart(width)} | `
    return `<span${number === code.line ? ' class="at"' : ''}>${escapeHtml(label + text)}</span>`
  })
  return `<pre class="code">${rows.join('')}</pre>`
}

const REDIRECT_NAMES: Record<number, string> = {
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
}

/** What an editor previewing a page that redirects sees, rather than the frame navigating away. Pure. */
export function previewRedirectNotice(status: number, location: string): string {
  const name = REDIRECT_NAMES[status] ?? 'Redirect'
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>This page redirects</title><style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style></head><body><main><h1>This page redirects</h1><p>Visitors are sent to <a href="${escapeHtml(location)}" target="_top">${escapeHtml(location)}</a> with ${status} ${escapeHtml(name)}.</p></main></body></html>`
}
