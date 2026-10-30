/**
 * Story 050: Umbraco's Delivery API contract, vendored from release-18.2.0's
 * expected generic contract. If these counts move, it was re-vendored from
 * another version — fine, but deliberate.
 */
import { describe, expect, test } from 'bun:test'
import { richTextTree } from '@crombolo/api-delivery'
import {
  DELIVERY_CONTRACT_ADDITIONS,
  findDuplicateOperationIds,
  listOperations,
  loadDeliverySpec,
  loadUmbracoDeliverySpec,
} from '@crombolo/contracts'

describe('the vendored Delivery API contract', () => {
  const spec = loadDeliverySpec()

  test('is OpenAPI 3.1.1 for the Umbraco Delivery API', () => {
    expect(spec.openapi).toBe('3.1.1')
    expect(spec.info.title).toBe('Umbraco Delivery API')
  })

  test('has the eight content and media operations, at v2', () => {
    const operations = listOperations(spec)
    expect(operations.map((op) => op.operationId).sort()).toEqual([
      'GetContent2.0',
      'GetContentItemById2.0',
      'GetContentItemByPath2.0',
      'GetContentItems2.0',
      'GetMedia2.0',
      'GetMediaItemById2.0',
      'GetMediaItemByPath2.0',
      'GetMediaItems2.0',
    ])
    expect(new Set(operations.map((op) => op.version))).toEqual(new Set(['2']))
    expect(Object.keys(loadUmbracoDeliverySpec().components.schemas)).toHaveLength(10)
    expect(findDuplicateOperationIds(operations)).toEqual([])
  })
})

type Schema = {
  $ref?: string
  const?: unknown
  type?: string
  required?: string[]
  properties?: Record<string, Schema>
  items?: Schema
  oneOf?: Schema[]
}

/** Where `value` breaks `schema`: enough of JSON Schema for the rich-text tree's. */
function problems(value: unknown, schema: Schema, at = '$'): string[] {
  const schemas = loadDeliverySpec().components.schemas as Record<string, Schema>
  if (schema.$ref)
    return problems(value, schemas[schema.$ref.split('/').pop() as string] as Schema, at)
  if (schema.oneOf) {
    const type = (value as { $type?: string }).$type
    const chosen = schema.oneOf.find((s) => s.$ref?.endsWith(`/${type}`))
    return chosen ? problems(value, chosen, at) : [`${at}: no schema for $type ${type}`]
  }
  if ('const' in schema) return value === schema.const ? [] : [`${at}: not ${schema.const}`]
  if (schema.type === 'string') return typeof value === 'string' ? [] : [`${at}: not a string`]
  if (schema.type === 'array')
    return Array.isArray(value)
      ? value.flatMap((item, i) =>
          schema.items ? problems(item, schema.items, `${at}[${i}]`) : [],
        )
      : [`${at}: not an array`]
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return [`${at}: not an object`]
  const record = value as Record<string, unknown>
  return [
    ...(schema.required ?? []).filter((key) => !(key in record)).map((key) => `${at}: no ${key}`),
    ...Object.keys(record)
      .filter((key) => schema.properties && !(key in schema.properties))
      .map((key) => `${at}: unexpected ${key}`),
    ...Object.entries(schema.properties ?? {}).flatMap(([key, sub]) =>
      key in record ? problems(record[key], sub, `${at}.${key}`) : [],
    ),
  ]
}

describe('rich text in the contract (story 216)', () => {
  test("the tree is added to Umbraco's contract, which stays as vendored", () => {
    const schemas = loadDeliverySpec().components.schemas
    for (const addition of DELIVERY_CONTRACT_ADDITIONS) {
      expect(schemas[addition.schema]).toEqual(addition.definition)
      expect(loadUmbracoDeliverySpec().components.schemas[addition.schema]).toBeUndefined()
    }
    expect(Object.keys(schemas)).toHaveLength(10 + DELIVERY_CONTRACT_ADDITIONS.length)
  })

  test('a tree the Delivery API writes is what the contract describes', async () => {
    const tree = await richTextTree(
      '<h2 data-anchor="x">Title</h2><p>Some <strong>bold</strong><br>text</p><umb-rte-block data-content-key="eed5fc6b96fd45a5a0f1b1adfb483c2f"></umb-rte-block>',
      [],
      { content: () => undefined, route: () => undefined, media: async () => [] },
    )
    expect(problems(tree, { $ref: '#/components/schemas/RichTextRootElement' })).toEqual([])
    expect(
      problems({ ...tree, $type: 'x' }, { $ref: '#/components/schemas/RichTextRootElement' }),
    ).toEqual(['$: unexpected $type'])
  })
})

describe('the Delivery API serves its contract', () => {
  test('every operation is answered by the handler, as coverage:api counts it', async () => {
    const { createDeliveryApi, deliveryCoverage, resolveDeliveryApiSettings } = await import(
      '@crombolo/api-delivery'
    )
    const { PublishedCache } = await import('@crombolo/render')
    const coverage = await deliveryCoverage(
      createDeliveryApi({
        settings: resolveDeliveryApiSettings({ enabled: true, media: { enabled: true } }),
        cache: new PublishedCache({ loadPublished: async () => [] }),
        prefix: '/umbraco/delivery/api',
        protection: async () => [],
        member: async () => undefined,
      }),
    )
    expect(coverage.served.size).toBe(coverage.operations.length)
  })
})
