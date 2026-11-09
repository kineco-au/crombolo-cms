/**
 * What an extension's server half is written against (story 311). The CMS
 * bundles the extension with this package and runs it in a Deno process of its
 * own, so nothing here reaches the CMS except through the channel: routes,
 * events, jobs and workflows arrive as messages, and each capability call goes
 * back to the host, which checks it against the extension's grant.
 *
 * The API is `@crombolo/crombolo/bundle`'s, which an extension may still import:
 * the build points that name here. docs/extensions.md.
 */
import { sectionKey } from '@crombolo/core/sections'
import type { BundleStep, BundleTables, ShapeOf } from './types.ts'

export * from '@crombolo/common'
export type * from './types.ts'

/** Declares the extension's own tables, built when the CMS starts it. */
export function defineBundleTables<const Steps extends readonly BundleStep[]>(
  id: string,
  steps: Steps,
): BundleTables<ShapeOf<Steps>> {
  return Object.freeze({ id, steps: Object.freeze([...steps]) }) as BundleTables<ShapeOf<Steps>>
}

/** Whether a back-office caller holds a section, named in either vocabulary. */
export function hasSection(principal: { allowedSections: readonly string[] }, section: string) {
  return principal.allowedSections.some((held) => sectionKey(held) === sectionKey(section))
}

/** Whether a back-office caller may work in every culture named. */
export function hasCultureAccess(
  principal: { hasAccessToAllLanguages: boolean; languages: readonly string[] },
  cultures: readonly string[],
): boolean {
  if (principal.hasAccessToAllLanguages) return true
  const allowed = new Set(principal.languages.map((l) => l.toLowerCase()))
  return cultures.every((c) => allowed.has(c.toLowerCase()))
}
