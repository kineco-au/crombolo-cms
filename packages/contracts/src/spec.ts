/** Loads and indexes the vendored Umbraco Management API OpenAPI contract. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyOverrides, DELIVERY_CONTRACT_ADDITIONS } from './overrides.ts'

export const SPEC_PATH = join(import.meta.dir, '../OpenApi.json')

/** Umbraco's Delivery API at release-18.2.0: its generic contract (story 050). */
export const DELIVERY_SPEC_PATH = join(import.meta.dir, '../DeliveryApi.json')

export const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export interface OperationInfo {
  operationId: string
  method: HttpMethod
  /** Full path as written in the spec, e.g. /umbraco/management/api/v1/document/{id} */
  path: string
  /** Version segment parsed out of the path, e.g. "1" or "1.1" */
  version: string | undefined
  /** First tag, used to group operations by area. */
  tag: string | undefined
  /** Path segment after the version, e.g. "document" */
  area: string | undefined
  /**
   * True when the operation overrides the document's global security with an
   * empty requirement. Exactly 10 operations do this in Umbraco 18.
   */
  anonymous: boolean
}

export interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string }
  security?: unknown[]
  paths: Record<
    string,
    Record<string, { operationId?: string; tags?: string[]; security?: unknown[] }>
  >
  components: { schemas: Record<string, unknown> }
}

let cached: OpenApiSpec | undefined
let served: string | undefined

/** Umbraco's contract exactly as vendored, before crombolo's deliberate differences. */
export function loadUmbracoSpec(): OpenApiSpec {
  return JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiSpec
}

/** The contract crombolo answers to: Umbraco's, with `CONTRACT_OVERRIDES` applied. */
export function loadSpec(): OpenApiSpec {
  if (!cached) cached = applyOverrides(loadUmbracoSpec())
  return cached
}

/** The contract as `GET …/openapi.json` serves it. */
/**
 * The contract as a site serves it. With `prefix`, its paths are moved from
 * Umbraco's `/umbraco/management/api/` to where this site serves the API.
 */
export function servedContract(prefix?: string): string {
  if (!served) served = JSON.stringify(loadSpec())
  if (!prefix || prefix === UMBRACO_PREFIX) return served
  let moved = servedAt.get(prefix)
  if (!moved) {
    moved = served.replaceAll(`"${UMBRACO_PREFIX}`, `"${prefix}`)
    servedAt.set(prefix, moved)
  }
  return moved
}

const UMBRACO_PREFIX = '/umbraco/management/api/'
const servedAt = new Map<string, string>()

let deliveryCached: OpenApiSpec | undefined

/** Umbraco's Delivery API contract exactly as vendored. */
export function loadUmbracoDeliverySpec(): OpenApiSpec {
  return JSON.parse(readFileSync(DELIVERY_SPEC_PATH, 'utf8')) as OpenApiSpec
}

/** The Delivery API contract crombolo answers to: Umbraco's, with `DELIVERY_CONTRACT_ADDITIONS`. */
export function loadDeliverySpec(): OpenApiSpec {
  if (!deliveryCached) {
    const spec = loadUmbracoDeliverySpec()
    for (const addition of DELIVERY_CONTRACT_ADDITIONS) {
      if (spec.components.schemas[addition.schema])
        throw new Error(`The Delivery API contract already has a schema ${addition.schema}`)
      spec.components.schemas[addition.schema] = structuredClone(addition.definition)
    }
    deliveryCached = spec
  }
  return deliveryCached
}

export async function loadSpecAsync(): Promise<OpenApiSpec> {
  if (!cached) cached = applyOverrides((await Bun.file(SPEC_PATH).json()) as OpenApiSpec)
  return cached
}

const VERSION_RE = /\/api\/v(\d+(?:\.\d+)?)\//

export function parsePath(path: string): { version?: string; area?: string } {
  const m = VERSION_RE.exec(path)
  if (!m) return {}
  const version = m[1]
  const rest = path.slice(m.index + m[0].length)
  const area = rest.split('/')[0] || undefined
  return { version, area }
}

export function listOperations(spec: OpenApiSpec): OperationInfo[] {
  const out: OperationInfo[] = []
  for (const [path, item] of Object.entries(spec.paths)) {
    const { version, area } = parsePath(path)
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (!op?.operationId) continue
      out.push({
        operationId: op.operationId,
        method,
        path,
        version,
        tag: op.tags?.[0],
        area,
        anonymous: Array.isArray(op.security) && op.security.length === 0,
      })
    }
  }
  return out
}

/** Operation ids must be unique — the generated client keys methods on them. */
export function findDuplicateOperationIds(ops: OperationInfo[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const op of ops) {
    if (seen.has(op.operationId)) dupes.add(op.operationId)
    seen.add(op.operationId)
  }
  return [...dupes]
}
