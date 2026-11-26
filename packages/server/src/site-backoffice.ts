/**
 * Story 431: the site's own back-office sections. Each is a grant of its own, with
 * places, each a menu of screens the site's back-office code draws, and routes below
 * `<back office>/crombolo/api/site/<section>/` given `site()` as the signed-in user.
 * docs/rendering.md, "Staff screens".
 */
import { existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type { Principal } from '@crombolo/api-management'
import type { RouteMethod, SiteRoute } from '@crombolo/common'
import { CORE_SECTION_ALIASES } from '@crombolo/core'
import type { RequestMember, SiteServices } from '@crombolo/render'

/** One screen in a place's menu: a module of the site's whose default export is a custom element. */
export interface SiteScreen {
  alias: string
  label: string
  icon?: string
  /** Relative to the site, as `./backoffice/review.ts`. */
  module: string
}

export interface SitePlace {
  alias: string
  label: string
  menu: readonly SiteScreen[]
}

/** What a back-office route is given besides a site route's context. */
export interface SiteBackOfficeRouteExtra {
  /** The signed-in user, already holding the section. */
  principal: Principal
}

export type SiteBackOfficeRoute = SiteRoute<SiteServices, RequestMember, SiteBackOfficeRouteExtra>

export interface SiteSection {
  /** Its address and its grant: `observations` is `Site.Section.observations`. */
  alias: string
  label: string
  icon?: string
  places: readonly SitePlace[]
  /** Paths relative to the section's, as `records/:id`. */
  routes?: readonly SiteBackOfficeRoute[]
}

/**
 * Story 437: a side panel of the site's own, in every section, opened from its toggle in
 * the header: a grant of its own, `Site.Panel.<alias>`, and routes behind it.
 */
export interface SitePanel {
  alias: string
  label: string
  icon?: string
  /** A path in the site, `./backoffice/help.ts`, or a package the site depends on, `@acme/host/help.ts`. */
  module: string
  /** Paths relative to the panel's, as a section's are. */
  routes?: readonly SiteBackOfficeRoute[]
  /** Story 438: every signed-in user has it, with no grant, and its routes answer them all. */
  everyone?: boolean
}

export interface SiteBackOfficeConfig {
  sections?: readonly SiteSection[]
  panels?: readonly SitePanel[]
  /**
   * Story 438: modules of the site's own run as the back office starts, for everyone signed
   * in: each exports `onInit(host, extensionRegistry)`, registering what it needs.
   */
  entryPoints?: readonly string[]
}

export const SITE_PANEL_PREFIX = 'Site.Panel.'

/** The grant a site panel is held by. */
export const sitePanelAlias = (alias: string) => `${SITE_PANEL_PREFIX}${alias}`

const SOURCE = /\.(m?[jt]s|[jt]sx)$/

/**
 * Story 437: a module's file, from a path in the site or a package the site depends on,
 * resolved as the site's imports are; why it cannot be, otherwise.
 */
export function resolveModule(
  siteDir: string,
  module: string,
): { file: string } | { problem: string } {
  if (typeof module !== 'string' || module === '') return { problem: 'it names no module' }
  if (!SOURCE.test(module))
    return { problem: `its module ${module} is not a .ts, .tsx or .js file` }
  if (module.startsWith('./')) {
    if (module.split('/').includes('..'))
      return { problem: `its module ${module} is outside the site` }
    const file = normalize(join(siteDir, module))
    if (!file.startsWith(`${normalize(siteDir)}${sep}`))
      return { problem: `its module ${module} is outside the site` }
    return existsSync(file) ? { file } : { problem: `its module ${module} is not there` }
  }
  if (module.startsWith('/') || module.startsWith('.') || /^[a-z]+:/i.test(module))
    return {
      problem: `its module ${module} is neither a path in the site starting with ./ nor a package's`,
    }
  try {
    return { file: Bun.resolveSync(module, siteDir) }
  } catch {
    return { problem: `its module ${module} is in no package the site depends on` }
  }
}

export const SITE_SECTION_PREFIX = 'Site.Section.'

/** The grant a site section is held by. */
export const siteSectionAlias = (alias: string) => `${SITE_SECTION_PREFIX}${alias}`

/** Who the site's back-office routes are declared by, for logs and the audit. */
export const SITE_BACKOFFICE_OWNER = "the site's back office"

const ALIAS = /^[a-z][a-z0-9-]{0,39}$/
/** The back office's own addresses under `section/`, which a site's section cannot take. */
const RESERVED = new Set([
  'content',
  'media',
  'settings',
  'members',
  'member-management',
  'users',
  'user-management',
  'translation',
  'library',
  'forms',
  'workflow',
  'approvals',
  'packages',
  'dictionary',
  'workspaces',
  'help',
])
const METHODS: readonly RouteMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']

/** Why the config's sections cannot be mounted, every one; empty when they can. */
export function siteBackOfficeProblems(
  config: SiteBackOfficeConfig | undefined,
  siteDir: string,
): string[] {
  if (!config) return []
  const problems: string[] = []
  const sections = new Set<string>()
  const core = new Set(CORE_SECTION_ALIASES.map((alias) => alias.toLowerCase()))
  for (const module of config.entryPoints ?? []) {
    const resolved = resolveModule(siteDir, module)
    if ('problem' in resolved) problems.push(`The back-office entry point: ${resolved.problem}.`)
  }
  for (const panel of config.panels ?? []) {
    const name = `The back-office panel "${panel.alias}"`
    if (!ALIAS.test(panel.alias ?? ''))
      problems.push(
        `${name}: an alias is lowercase letters, digits and hyphens, starting with a letter.`,
      )
    if (sections.has(panel.alias))
      problems.push(`${name} has the alias of another section or panel.`)
    sections.add(panel.alias)
    if (!panel.label?.trim()) problems.push(`${name} has no label.`)
    const resolved = resolveModule(siteDir, panel.module)
    if ('problem' in resolved) problems.push(`${name}: ${resolved.problem}.`)
    problems.push(...routeProblems(name, panel.routes))
  }
  for (const section of config.sections ?? []) {
    const name = `The back-office section "${section.alias}"`
    if (!ALIAS.test(section.alias ?? ''))
      problems.push(
        `${name}: an alias is lowercase letters, digits and hyphens, starting with a letter.`,
      )
    if (sections.has(section.alias))
      problems.push(`${name} has the alias of another section or panel.`)
    sections.add(section.alias)
    if (
      core.has(siteSectionAlias(section.alias).toLowerCase()) ||
      RESERVED.has(section.alias ?? '')
    )
      problems.push(`${name} takes the address of one of the back office's own sections.`)
    if (!section.label?.trim()) problems.push(`${name} has no label.`)
    if (!section.places?.length) problems.push(`${name} has no places.`)
    const places = new Set<string>()
    for (const place of section.places ?? []) {
      const where = `${name}, place "${place.alias}"`
      if (!ALIAS.test(place.alias ?? '')) problems.push(`${where}: the alias is not one.`)
      if (places.has(place.alias)) problems.push(`${where} is declared twice.`)
      places.add(place.alias)
      if (!place.label?.trim()) problems.push(`${where} has no label.`)
      if (!place.menu?.length) problems.push(`${where} has no screens in its menu.`)
      const screens = new Set<string>()
      for (const screen of place.menu ?? []) {
        const what = `${where}, screen "${screen.alias}"`
        if (!ALIAS.test(screen.alias ?? '')) problems.push(`${what}: the alias is not one.`)
        if (screens.has(screen.alias)) problems.push(`${what} is declared twice.`)
        screens.add(screen.alias)
        if (!screen.label?.trim()) problems.push(`${what} has no label.`)
        const resolved = resolveModule(siteDir, screen.module)
        if ('problem' in resolved) problems.push(`${what}: ${resolved.problem}.`)
      }
    }
    problems.push(...routeProblems(name, section.routes))
  }
  return problems
}

function routeProblems(name: string, routes: readonly SiteBackOfficeRoute[] | undefined): string[] {
  const problems: string[] = []
  const paths = new Set<string>()
  for (const route of routes ?? []) {
    const where = `${name}, route "${route.path}"`
    if (route.path.startsWith('/'))
      problems.push(`${where}: a back-office route's path is relative to its section's.`)
    const key = route.path.toLowerCase().replace(/:[^/]+/g, ':')
    if (paths.has(key)) problems.push(`${where} is declared twice.`)
    paths.add(key)
    const unknown = Object.keys(route.handlers).filter(
      (method) => !METHODS.includes(method as RouteMethod),
    )
    if (unknown.length > 0) problems.push(`${where} names ${unknown.join(', ')}.`)
  }
  return problems
}

/** Every module the sections' screens and the panels name, once each, as the config spells them. */
export function siteBackOfficeModules(config: SiteBackOfficeConfig | undefined): string[] {
  return [
    ...new Set([
      ...(config?.sections ?? []).flatMap((section) =>
        section.places.flatMap((place) => place.menu.map((screen) => screen.module)),
      ),
      ...(config?.panels ?? []).map((panel) => panel.module),
      ...(config?.entryPoints ?? []),
    ]),
  ]
}

/**
 * A route below a section or a panel, by its alias, with the grant that opens it and its
 * params; the grant alone when no route matches; undefined for no such alias.
 */
export function matchSiteBackOfficeRoute(
  config: SiteBackOfficeConfig | undefined,
  requested: string,
):
  | {
      /** What opens it; undefined for a panel everyone has (story 438). */
      grant: string | undefined
      route?: SiteBackOfficeRoute
      params: Record<string, string>
    }
  | undefined {
  const slash = requested.indexOf('/')
  const alias = slash === -1 ? requested : requested.slice(0, slash)
  const section = config?.sections?.find((candidate) => candidate.alias === alias)
  const panel = section ? undefined : config?.panels?.find((candidate) => candidate.alias === alias)
  if (!section && !panel) return undefined
  const grant = section
    ? siteSectionAlias(alias)
    : panel?.everyone
      ? undefined
      : sitePanelAlias(alias)
  const rest = (slash === -1 ? '' : requested.slice(slash + 1)).replace(/\/$/, '')
  for (const route of (section ?? panel)?.routes ?? []) {
    const params = matchPath(route.path, rest)
    if (params) return { grant, route, params }
  }
  return { grant, params: {} }
}

function matchPath(path: string, requested: string): Record<string, string> | undefined {
  const declared = path.replace(/\/$/, '').split('/')
  const actual = requested.split('/')
  if (declared.length !== actual.length) return undefined
  const params: Record<string, string> = {}
  for (const [index, segment] of declared.entries()) {
    const value = actual[index] as string
    if (segment.startsWith(':')) {
      if (value === '') return undefined
      params[segment.slice(1)] = decodeURIComponent(value)
    } else if (segment !== value) return undefined
  }
  return params
}

/** Sections that take one another's address or grant: the site's and each extension's, by name. */
export function sectionClashes(
  config: SiteBackOfficeConfig | undefined,
  extensions: readonly { name: string; sections?: readonly { alias: string; path: string }[] }[],
): string[] {
  const claimed = new Map<string, string>()
  const problems: string[] = []
  const claim = (key: string, who: string, what: string) => {
    const other = claimed.get(key.toLowerCase())
    if (other) problems.push(`${other} and ${who} both claim the section ${what}.`)
    else claimed.set(key.toLowerCase(), who)
  }
  for (const section of config?.sections ?? []) {
    claim(`path:${section.alias}`, 'the site', `at section/${section.alias}`)
    claim(`alias:${siteSectionAlias(section.alias)}`, 'the site', siteSectionAlias(section.alias))
  }
  for (const extension of extensions)
    for (const section of extension.sections ?? []) {
      claim(`path:${section.path}`, extension.name, `at section/${section.path}`)
      claim(`alias:${section.alias}`, extension.name, section.alias)
    }
  return problems
}
