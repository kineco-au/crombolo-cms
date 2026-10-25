/**
 * The keys schema elements get without a key line (story 161), in one place so
 * sync, which assigns them, and the writer, which leaves them out of a file,
 * agree. A built-in's shipped key comes first; otherwise the key is derived
 * from what the element names, so every node and environment computes the
 * same one.
 */
import { derivedKey } from '@crombolo/core'
import {
  ALL_SEEDED_DATA_TYPES,
  BUILT_IN_MEDIA_TYPES,
  SYSTEM_CONTENT_TYPES,
  SYSTEM_MEDIA_TYPES,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import { systemPropertyKeys } from './builtin.ts'
import type { SchemaTypeKind } from './model.ts'

/**
 * The key a file gets for an element with no key line (story 161): a built-in's
 * shipped key, else the one derived from what it names. Every node and every
 * environment computes the same one, which is what lets a file carry none.
 */
export const typeKeyFor = (kind: SchemaTypeKind, alias: string): string =>
  (kind === 'document'
    ? SYSTEM_CONTENT_TYPES.find((t) => t.alias === alias)?.key
    : kind === 'media'
      ? (SYSTEM_MEDIA_TYPES.find((t) => t.alias === alias)?.key ??
        BUILT_IN_MEDIA_TYPES.find((t) => t.alias === alias)?.key)
      : SYSTEM_MEMBER_TYPE.alias === alias
        ? SYSTEM_MEMBER_TYPE.key
        : undefined) ?? derivedKey('type', kind, alias)

export const dataTypeKeyFor = (alias: string): string =>
  ALL_SEEDED_DATA_TYPES.find((d) => d.alias === alias)?.key ?? derivedKey('data-type', alias)

/** A property's key with no key line: a built-in type's shipped one, else derived from its type's. */
export const propertyKeyFor = (
  typeKey: string,
  alias: string,
  shipped: ReadonlyMap<string, string> = new Map(),
): string => shipped.get(alias) ?? derivedKey(typeKey, alias)

/** The shipped property keys of a built-in content type, by alias; none for anything else. */
export function shippedPropertyKeys(
  kind: SchemaTypeKind,
  typeAlias: string,
): ReadonlyMap<string, string> {
  if (kind === 'document' && SYSTEM_CONTENT_TYPES.some((t) => t.alias === typeAlias))
    return systemPropertyKeys(typeAlias)
  // Umbraco's media types, the system ones and those `crombolo init` writes, keep
  // Umbraco's property keys, so a keyless file and an init-written one agree.
  const media =
    kind === 'media' ? BUILT_IN_MEDIA_TYPES.find((t) => t.alias === typeAlias) : undefined
  return new Map((media?.properties ?? []).map((p) => [p.alias, p.key]))
}

/** Whether a key is the one an element would get without a key line, so a file need not say it. */
export const isDerived = (key: string | undefined, expected: string): boolean =>
  key === undefined || key.toLowerCase() === expected.toLowerCase()
