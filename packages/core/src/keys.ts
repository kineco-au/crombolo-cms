/**
 * Keys made from names (stories 161, 163): RFC 4122 version 5 uuids, so every
 * node and every environment computes the same key for the same thing without
 * writing it down. Each family has a namespace of its own, fixed for ever:
 * changing one re-keys everything made under it.
 */

/** Seed items (story 163): content, Library and media, named by kind and path. */
export const SEED_NAMESPACE = '6f1d3c0e-7a52-4b8e-9c41-2e5f8a1b7d63'

/** Schema elements (story 161): types, properties, data types, forms, workflows, webhooks. */
export const SCHEMA_NAMESPACE = 'b3c8e2a4-1f6d-4a9b-8e37-5d0c2f9a6b14'

const bytesOf = (uuid: string): Uint8Array => {
  const hex = uuid.replaceAll('-', '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** A version 5 uuid for `name` in `namespace`. Pure. */
export function uuidV5(name: string, namespace: string): string {
  const hash = new Bun.CryptoHasher('sha1')
    .update(bytesOf(namespace))
    .update(name)
    .digest() as Uint8Array
  const bytes = hash.subarray(0, 16)
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The key a schema element has when its file gives none (story 161), from
 * what it names: `derivedKey('type', 'document', 'homePage')`,
 * `derivedKey(typeKey, 'title')` for a property. The parts are joined with a
 * NUL, so no two lists of parts collide. Pure.
 */
export const derivedKey = (...parts: readonly string[]): string =>
  uuidV5(parts.map((part) => part.toLowerCase()).join('\0'), SCHEMA_NAMESPACE)
