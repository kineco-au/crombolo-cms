/**
 * What of the site's schema the served copy holds (story 395), from the changes a
 * host reported applying there. Schema is served when the change that last touched
 * it was reported, or came before the oldest one reported. Only what the served
 * copy does not have at all is held back from making content; a page using
 * anything not yet served names the changes it needs.
 */
import { normaliseUuid, problemDetails, problemResponse } from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  type Db,
  type FileVersion,
  ServedChangeRepository,
} from '@crombolo/data'

const TYPE_FILES = 'schema/content-types/'
const COMPONENT_FILES = 'components/'

/** What a page needs, by the kind a host is told. */
export type NeededKind = 'documentType' | 'elementType' | 'template'

/** One unserved change a page needs, and what for. */
export interface NeededChange {
  key: string
  name: string | null
  items: Array<{ kind: NeededKind; alias: string }>
}

interface Item {
  kind: NeededKind
  key: string
  alias: string
  made: boolean
  changes: Array<{ key: string; name: string | null }>
}

/** What the served copy lacks, when a host has reported anything. */
export interface ServedView {
  /** Types and element types the served copy does not have. */
  hiddenTypes: ReadonlySet<string>
  /** Templates, by component key, the served copy does not have. */
  hiddenTemplates: ReadonlySet<string>
  /** Everything touched since, made or changed, by its key. */
  pending: ReadonlyMap<string, Item>
}

const firstLine = (text: string, name: string) =>
  new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(text)?.[1]

const cache = new WeakMap<Db, { revision: string; view: ServedView | undefined }>()

/** The served copy's view of the schema, or undefined while nothing is reported. */
export async function servedView(db: Db): Promise<ServedView | undefined> {
  const served = new ServedChangeRepository(db)
  const revision = await served.revision()
  const known = cache.get(db)
  if (known?.revision === revision) return known.view
  const view = await build(db, served)
  cache.set(db, { revision, view })
  return view
}

async function build(db: Db, served: ServedChangeRepository): Promise<ServedView | undefined> {
  const reported = await served.keys()
  if (reported.size === 0) return undefined
  const since = (await served.since())?.getTime() ?? Number.POSITIVE_INFINITY
  const isServed = (v: FileVersion) =>
    reported.has(normaliseUuid(v.changeKey)) || v.startedAt.getTime() < since
  const byPath = new Map<string, FileVersion[]>()
  for (const v of await served.fileVersions([TYPE_FILES, COMPONENT_FILES]))
    byPath.set(v.path, [...(byPath.get(v.path) ?? []), v])
  const latest = [...byPath.values()].map((vs) => vs[vs.length - 1] as FileVersion)
  const texts = await served.texts(
    latest.flatMap((v) => (v.afterHash && v.path.startsWith(TYPE_FILES) ? [v.afterHash] : [])),
  )
  const typeKeys = new Map(
    [...(await new ContentTypeRepository(db).aliasesByKey())].map(([key, alias]) => [alias, key]),
  )
  const componentKeys = new Map(
    (await new ComponentRepository(db).all()).map((c) => [c.alias, c.key]),
  )

  const hiddenTypes = new Set<string>()
  const hiddenTemplates = new Set<string>()
  const pending = new Map<string, Item>()
  for (const [path, versions] of byPath) {
    const last = versions[versions.length - 1] as FileVersion
    if (last.removed) continue
    const identity = identityOf(path, last, texts, typeKeys, componentKeys)
    if (!identity) continue
    const unserved = versions.filter((v) => !isServed(v))
    if (unserved.length === 0) continue
    const madeAt = [...versions].reverse().find((v) => v.made)
    const made = madeAt !== undefined && !isServed(madeAt)
    const changes = [
      ...new Map(unserved.map((v) => [v.changeKey, { key: v.changeKey, name: v.changeName }])),
    ].map(([, c]) => c)
    pending.set(identity.key, { ...identity, made, changes })
    if (made) (identity.kind === 'template' ? hiddenTemplates : hiddenTypes).add(identity.key)
  }
  return { hiddenTypes, hiddenTemplates, pending }
}

function identityOf(
  path: string,
  last: FileVersion,
  texts: ReadonlyMap<string, string>,
  typeKeys: ReadonlyMap<string, string>,
  componentKeys: ReadonlyMap<string, string>,
): { kind: NeededKind; key: string; alias: string } | undefined {
  if (path.startsWith(TYPE_FILES)) {
    const text = last.afterHash ? texts.get(last.afterHash) : undefined
    const alias = text ? firstLine(text, 'alias') : undefined
    if (!text || !alias) return undefined
    const key = firstLine(text, 'key') ?? typeKeys.get(alias)
    if (!key) return undefined
    const element = /^is-element\s*=\s*true/m.test(text)
    return { kind: element ? 'elementType' : 'documentType', key: normaliseUuid(key), alias }
  }
  const alias = path
    .slice(COMPONENT_FILES.length)
    .replace(/\.[a-z]+$/i, '')
    .split('/')
    .pop()
  const key = alias ? componentKeys.get(alias) : undefined
  return alias && key ? { kind: 'template', key: normaliseUuid(key), alias } : undefined
}

const ELEMENT_KEY = /"contentTypeKey"\s*:\s*"([0-9a-f-]{36})"/gi

/**
 * The unserved changes a page needs: those that made or last changed its type, its
 * template, or the element types its blocks use. Empty when it needs none.
 */
export function neededBy(
  view: ServedView,
  page: { contentTypeKey: string; componentKey: string | null; values: unknown },
): NeededChange[] {
  const keys = new Set([normaliseUuid(page.contentTypeKey)])
  if (page.componentKey) keys.add(normaliseUuid(page.componentKey))
  for (const m of JSON.stringify(page.values ?? []).matchAll(ELEMENT_KEY))
    keys.add(normaliseUuid(m[1] as string))
  const out = new Map<string, NeededChange>()
  for (const key of keys) {
    const item = view.pending.get(key)
    if (!item) continue
    for (const change of item.changes) {
      const entry = out.get(change.key) ?? { ...change, items: [] }
      if (!entry.items.some((i) => i.kind === item.kind && i.alias === item.alias))
        entry.items.push({ kind: item.kind, alias: item.alias })
      out.set(change.key, entry)
    }
  }
  return [...out.values()]
}

/** Operations that change schema or code, refused outside a named workspace once anything is reported. */
export function isSchemaWrite(operationId: string, method: string): boolean {
  if (method === 'GET') return false
  if (/Folder|AvailableCompositions|QueryExecute/.test(operationId)) return false
  return /^(Post|Put|Delete|Patch)(DocumentType|MediaType|MemberType|DataType|PartialView|Script|Stylesheet|Template)/.test(
    operationId,
  )
}

/** The refusal of a schema change outside a named workspace. */
export const schemaInWorkspace = (): Response =>
  problemResponse(
    problemDetails({
      title: 'Build this in a workspace',
      status: 409,
      detail:
        'Types, data types, templates, components, stylesheets and scripts go to the live site with a release here: open a workspace to change them.',
    }),
  )

/** Operations whose answer offers types for a new page or Library item. */
export const OFFERS_TYPES: ReadonlySet<string> = new Set([
  'GetDocumentTypeAllowedAtRoot',
  'GetDocumentTypeByIdAllowedChildren',
  'GetDocumentTypeAllowedInLibrary',
])

/** The header the back office sends when someone is making content, rather than schema. */
export const PURPOSE_HEADER = 'crombolo-purpose'

type Json = Record<string, unknown>

/** An answer with what the served copy lacks taken out of what it offers. */
export async function withoutUnserved(
  response: Response,
  operationId: string,
  view: ServedView,
  makingContent: boolean,
): Promise<Response> {
  const types = OFFERS_TYPES.has(operationId)
  const typeDetail = makingContent && operationId === 'GetDocumentTypeById'
  const dataType = makingContent && operationId === 'GetDataTypeById'
  if (!response.ok || (!types && !typeDetail && !dataType)) return response
  const body = (await response.json()) as Json
  const hidden = (id: unknown) => typeof id === 'string' && view.hiddenTypes.has(normaliseUuid(id))
  if (types && Array.isArray(body.items)) {
    const items = (body.items as Json[]).filter((i) => !hidden(i.id))
    body.total = Math.max(
      0,
      Number(body.total ?? items.length) - (body.items.length - items.length),
    )
    body.items = items
  }
  if (typeDetail) {
    const template = (t: unknown) =>
      typeof (t as Json | null)?.id === 'string' &&
      view.hiddenTemplates.has(normaliseUuid((t as Json).id as string))
    if (Array.isArray(body.allowedTemplates))
      body.allowedTemplates = (body.allowedTemplates as unknown[]).filter((t) => !template(t))
    if (template(body.defaultTemplate)) body.defaultTemplate = null
  }
  if (dataType && Array.isArray(body.values))
    body.values = (body.values as Json[]).map((v) =>
      v.alias === 'blocks' && Array.isArray(v.value)
        ? {
            ...v,
            value: (v.value as Json[]).filter((b) => !hidden(b.contentElementTypeKey)),
          }
        : v,
    )
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(JSON.stringify(body), { status: response.status, headers })
}
