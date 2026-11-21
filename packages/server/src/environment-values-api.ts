/**
 * A property's value per environment, edited beside its field (story 387), at
 * `<plugin>/api/environment-values`: which environment this copy of the site is and
 * which the schema names; a page's properties that vary by environment, each with
 * its shared value and every environment's own; and one environment's value set or
 * cleared, saved as any edit of the page is. docs/environments.md.
 */
import type { Principal } from '@crombolo/api-management/domain'
import { type DocumentOperations, userActor } from '@crombolo/content'
import { type DocumentValue, normaliseUuid } from '@crombolo/core'
import {
  ContentTypeRepository,
  type Db,
  DocumentRepository,
  type DocumentRepositoryOptions,
  readEnvironments,
} from '@crombolo/data'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const json = (body: unknown, status = 200) => Response.json(body, { status })
const refused = (message: string, status: number) => json({ message }, status)

/** One property's values: the shared one, and each environment's that overrides it. */
export interface EnvironmentValues {
  alias: string
  name: string
  culture: string | null
  segment: string | null
  shared: unknown
  overrides: Array<{ environment: string; value: unknown; known: boolean }>
}

export function createEnvironmentValuesApi(
  db: Db,
  options: {
    environment: () => string
    repository: DocumentRepositoryOptions
    documents: () => DocumentOperations
    /** The values can only arrive by a change here (`environmentValues.readOnly`, or locked content). */
    readOnly: () => boolean
  },
) {
  /** The properties of a page that vary by environment, with each of their values. */
  async function valuesOf(key: string): Promise<EnvironmentValues[] | undefined> {
    const page = await new DocumentRepository(db, options.repository).byKey(key)
    if (!page) return undefined
    const type = await new ContentTypeRepository(db).byKey(page.contentTypeKey)
    const names = new Set(await readEnvironments(db))
    const varying = (type?.properties ?? []).filter((p) => p.variesByEnvironment)
    const out: EnvironmentValues[] = []
    for (const property of varying) {
      const mine = page.values.filter((v) => v.alias === property.alias)
      const slots = new Map<string, EnvironmentValues>()
      const slotOf = (v: DocumentValue) => {
        const id = `${v.culture ?? ''}|${v.segment ?? ''}`
        let slot = slots.get(id)
        if (!slot) {
          slot = {
            alias: property.alias,
            name: property.name,
            culture: v.culture,
            segment: v.segment,
            shared: null,
            overrides: [],
          }
          slots.set(id, slot)
        }
        return slot
      }
      for (const v of mine) {
        const slot = slotOf(v)
        if (v.environment)
          slot.overrides.push({
            environment: v.environment,
            value: v.value,
            known: names.has(v.environment),
          })
        else slot.shared = v.value
      }
      if (slots.size === 0)
        slots.set('|', {
          alias: property.alias,
          name: property.name,
          culture: null,
          segment: null,
          shared: null,
          overrides: [],
        })
      out.push(...slots.values())
    }
    return out
  }

  return {
    valuesOf,

    async handle(request: Request, principal: Principal, rest: string): Promise<Response> {
      const parts = rest.split('/').filter(Boolean)
      if (parts.length === 0 && request.method === 'GET')
        return json({
          current: options.environment(),
          names: await readEnvironments(db),
          readOnly: options.readOnly(),
        })
      const key = parts[0]
      if (parts.length !== 1 || !key || !UUID.test(key))
        return refused('There is no such page.', 404)
      if (request.method === 'GET') {
        // A page not saved yet has none: the editor asks as it opens one.
        return json({ items: (await valuesOf(normaliseUuid(key))) ?? [] })
      }
      if (request.method !== 'PUT') return new Response(null, { status: 405 })
      if (options.readOnly())
        return refused(
          "This environment's values arrive only by a change applied from where they are made.",
          409,
        )
      const asked = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
      const alias = typeof asked.alias === 'string' ? asked.alias : ''
      const environment = typeof asked.environment === 'string' ? asked.environment : ''
      const culture = typeof asked.culture === 'string' ? asked.culture : null
      const segment = typeof asked.segment === 'string' ? asked.segment : null
      if (!alias || !/^[a-z][a-z0-9-]{0,63}$/.test(environment))
        return refused('Name the property and the environment.', 400)
      const page = await new DocumentRepository(db, options.repository).byKey(normaliseUuid(key))
      if (!page) return refused('There is no such page.', 404)
      const type = await new ContentTypeRepository(db).byKey(page.contentTypeKey)
      if (!type?.properties.some((p) => p.alias === alias && p.variesByEnvironment))
        return refused(`"${alias}" does not vary by environment.`, 400)
      const same = (v: DocumentValue) =>
        v.alias === alias &&
        (v.culture ?? null) === culture &&
        (v.segment ?? null) === segment &&
        v.environment === environment
      // Every value is sent: one it leaves out of the property's environments is cleared.
      const values: DocumentValue[] = page.values.filter((v) => !same(v))
      if (asked.value !== null && asked.value !== undefined && asked.value !== '')
        values.push({ alias, culture, segment, environment, value: asked.value })
      const saved = await options.documents().save(
        userActor(principal),
        page.key,
        {
          key: page.key,
          contentTypeKey: page.contentTypeKey,
          componentKey: page.componentKey,
          parentKey: page.parentKey,
          values,
          variants: page.variants.map((v) => ({
            culture: v.culture,
            segment: v.segment,
            name: v.name,
          })),
        },
        // Saved on the copy it was just read at, as an editor's save names its revision.
        page.revision ? { expectedRevision: page.revision } : {},
      )
      if (!saved.ok) return refused(saved.reason, saved.status)
      return json({ items: (await valuesOf(page.key)) ?? [] })
    },
  }
}
