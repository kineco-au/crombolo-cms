/**
 * Story 456: our Delivery API output for block values, field by field, against
 * Umbraco's as its documentation shows it (`tests/fixtures/umbraco-delivery/`, each
 * file citing the page it follows). A difference is fixed, or deliberate and listed
 * in docs/delivery-api.md, "Blocks as Umbraco's".
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deliveryValue, type OutputContext } from '@crombolo/api-delivery'
import { convertValue } from '@crombolo/render'

const DIR = join(import.meta.dir, 'fixtures', 'umbraco-delivery')

interface Golden {
  source: string
  versions: string[]
  derivedFromSource: boolean
  property: { alias: string; editorAlias: string; config: Record<string, unknown> }
  contentTypes: Record<string, string>
  culture: string | null
  stored: unknown
  expected: unknown
  deliberate?: string[]
}

/** Every place two JSON values differ, by path. */
function differences(expected: unknown, actual: unknown, path = '$'): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected an array, got ${JSON.stringify(actual)}`]
    const out: string[] = []
    if (expected.length !== actual.length)
      out.push(`${path}: expected ${expected.length} items, got ${actual.length}`)
    for (let i = 0; i < Math.min(expected.length, actual.length); i++)
      out.push(...differences(expected[i], actual[i], `${path}[${i}]`))
    return out
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual))
      return [`${path}: expected an object, got ${JSON.stringify(actual)}`]
    const e = expected as Record<string, unknown>
    const a = actual as Record<string, unknown>
    const out: string[] = []
    for (const key of Object.keys(e))
      if (!(key in a)) out.push(`${path}.${key}: missing`)
      else out.push(...differences(e[key], a[key], `${path}.${key}`))
    for (const key of Object.keys(a)) if (!(key in e)) out.push(`${path}.${key}: not Umbraco's`)
    const order = Object.keys(e).filter((k) => k in a)
    const ours = Object.keys(a).filter((k) => k in e)
    if (order.join() !== ours.join())
      out.push(`${path}: fields in the order ${ours.join(', ')}, Umbraco's ${order.join(', ')}`)
    return out
  }
  return Object.is(expected, actual)
    ? []
    : [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`]
}

const goldens = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((file) => ({ file, golden: JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Golden }))

const ctx = {
  route: () => undefined,
  content: () => undefined,
  allowedType: () => true,
  access: () => 'allowed',
  media: async () => [],
} as unknown as OutputContext

async function ours(golden: Golden): Promise<unknown> {
  const context = {
    culture: golden.culture,
    content: () => undefined,
    urlOf: () => '',
    contentTypeAlias: (key: string) => golden.contentTypes[key.toLowerCase()] ?? null,
  }
  const property = {
    ...golden.property,
    culture: null,
    segment: null,
    value: golden.stored,
  }
  const converted = await convertValue(
    property.editorAlias,
    golden.stored,
    context as never,
    property.config,
  )
  return deliveryValue(property, converted, ctx, undefined, undefined)
}

describe('block output against Umbraco’s documented output (story 456)', () => {
  test('there is a golden file for each block editor, a grid with areas, nesting and variance', () => {
    expect(goldens.map((g) => g.file)).toEqual([
      'block-grid.json',
      'block-list.json',
      'nested-blocks.json',
      'rich-text-blocks.json',
      'single-block.json',
      'variant-block-da-DK.json',
      'variant-block-en-US.json',
    ])
    for (const { golden } of goldens) {
      expect(golden.source).toStartWith('https://docs.umbraco.com/')
      expect(golden.versions.length).toBeGreaterThan(0)
    }
  })

  for (const { file, golden } of goldens)
    test(`${file} matches field by field${golden.deliberate ? `, but for ${golden.deliberate.join(', ')}` : ''}`, async () => {
      const actual = (await ours(golden)) as Record<string, unknown>
      const expected = golden.expected as Record<string, unknown>
      const deliberate = new Set(golden.deliberate ?? [])
      const strip = (value: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(value).filter(([k]) => !deliberate.has(k)))
      const compared =
        deliberate.size > 0
          ? differences(strip(expected), strip(actual))
          : differences(expected, actual)
      expect(compared).toEqual([])
    })
})
