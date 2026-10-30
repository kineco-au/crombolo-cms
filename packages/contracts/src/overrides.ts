/**
 * Where crombolo's Management API differs from Umbraco's contract on purpose.
 * `OpenApi.json` stays exactly Umbraco's, so a re-copy from a new release is a
 * clean diff; each difference is listed here with its reason, and applied when
 * the contract is loaded and when it is served.
 */
export interface ContractOverride {
  /** The schema under `components.schemas` it changes. */
  schema: string
  story: string
  reason: string
  apply(schema: Record<string, unknown>): void
}

export const CONTRACT_OVERRIDES: readonly ContractOverride[] = [
  {
    schema: 'CreateMemberRequestModel',
    story: '035',
    reason:
      'A member who will only ever sign in through an identity provider is created with no password, as external sign-in creates one.',
    apply(schema) {
      schema.required = ((schema.required as string[] | undefined) ?? []).filter(
        (field) => field !== 'password',
      )
    },
  },
]

/** The contract with every override applied, leaving the one given untouched. */
export function applyOverrides<T extends { components: { schemas: Record<string, unknown> } }>(
  spec: T,
): T {
  const copy = structuredClone(spec)
  for (const override of CONTRACT_OVERRIDES) {
    const schema = copy.components.schemas[override.schema] as Record<string, unknown> | undefined
    if (!schema) throw new Error(`The contract has no schema ${override.schema} to override`)
    override.apply(schema)
  }
  return copy
}

const RICH_TEXT_ELEMENTS = {
  oneOf: [
    { $ref: '#/components/schemas/RichTextGenericElement' },
    { $ref: '#/components/schemas/RichTextTextElement' },
  ],
  discriminator: { propertyName: '$type' },
}

/**
 * Schemas crombolo's Delivery API adds to Umbraco's generic contract, where a
 * property's value is an untyped object. `DeliveryApi.json` stays exactly
 * Umbraco's; these are added when it is loaded.
 */
export const DELIVERY_CONTRACT_ADDITIONS: readonly {
  schema: string
  story: string
  reason: string
  definition: Record<string, unknown>
}[] = [
  {
    schema: 'RichTextRootElement',
    story: '216',
    reason:
      "Every rich-text value is this tree, Umbraco's RichTextOutputAsJson form, always on; the HTML form is not served.",
    definition: {
      type: 'object',
      required: ['tag', 'attributes', 'elements', 'blocks'],
      properties: {
        tag: { const: '#root' },
        attributes: { type: 'object' },
        elements: { type: 'array', items: RICH_TEXT_ELEMENTS },
        blocks: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    schema: 'RichTextGenericElement',
    story: '216',
    reason: 'An element of a rich-text tree.',
    definition: {
      type: 'object',
      required: ['$type', 'tag', 'attributes', 'elements'],
      properties: {
        $type: { const: 'RichTextGenericElement' },
        tag: { type: 'string' },
        attributes: { type: 'object' },
        elements: { type: 'array', items: RICH_TEXT_ELEMENTS },
      },
    },
  },
  {
    schema: 'RichTextTextElement',
    story: '216',
    reason: 'A text node of a rich-text tree.',
    definition: {
      type: 'object',
      required: ['$type', 'tag', 'text'],
      properties: {
        $type: { const: 'RichTextTextElement' },
        tag: { const: '#text' },
        text: { type: 'string' },
      },
    },
  },
]
