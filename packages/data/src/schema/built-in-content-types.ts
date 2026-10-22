/**
 * Content types this CMS ships, each a composition a site opts into, such as
 * `compositions = ["seoFields"]`. "Search & sharing" (`seoFields`) holds the
 * fields the head helper, the sitemap and the editor's preview read; "Caching"
 * (`cacheFields`, story 057) how long copies of a page may be kept.
 *
 * A **system** type, like the Folder, Image and File media types: ensured at
 * every boot, exempt from schema retirement, not deletable, alias fixed. A site
 * may extend it with a file of the same alias and key; the shipped fields stay.
 */
import {
  CACHE_FIELDS_PROPERTIES,
  type ContentTypeAggregate,
  MENU_ITEM_PROPERTIES,
  MENU_PROPERTIES,
  SEO_FIELDS_PROPERTIES,
  SYSTEM_CONTENT_TYPE_KEYS,
  type SystemPropertyModel,
} from '@crombolo/core'
import type { Db } from '../database.ts'
import { ContentTypeRepository } from '../repositories/content-types.ts'

export interface BuiltInContentType {
  key: string
  alias: string
  name: string
  description: string
  icon: string
  /** An element type: the menu types (story 141). */
  isElement?: boolean
  /** Offered for creating in the Library section. */
  allowedInLibrary?: boolean
  tab: { key: string; name: string; alias: string }
  properties: readonly SystemPropertyModel[]
}

export const SEO_FIELDS_TYPE: BuiltInContentType = {
  key: SYSTEM_CONTENT_TYPE_KEYS.SeoFields,
  alias: 'seoFields',
  name: 'Search & sharing',
  description: 'How a page appears in search results and when shared.',
  icon: 'icon-search',
  tab: { key: '3f8a1d6c-5e2b-4a07-9c84-b1e7d0f2a658', name: 'Search & sharing', alias: 'seo' },
  properties: SEO_FIELDS_PROPERTIES,
}

/** "Caching" (story 057): how long copies of a page may be kept, for the types that want it. */
export const CACHE_FIELDS_TYPE: BuiltInContentType = {
  key: SYSTEM_CONTENT_TYPE_KEYS.CacheFields,
  alias: 'cacheFields',
  name: 'Caching',
  description: 'How long copies of a page may be kept before they are asked for again.',
  icon: 'icon-timer',
  tab: { key: '0d6e2a49-7c1f-4b85-93a2-6f8e1b4c7d39', name: 'Caching', alias: 'caching' },
  properties: CACHE_FIELDS_PROPERTIES,
}

/** A menu (story 141): made in the Library, named by its alias in templates. */
export const MENU_TYPE: BuiltInContentType = {
  key: SYSTEM_CONTENT_TYPE_KEYS.Menu,
  alias: 'menu',
  name: 'Menu',
  description: 'Pages and links in the order a navigation shows them.',
  icon: 'icon-navigation',
  isElement: true,
  allowedInLibrary: true,
  tab: { key: '7d1c5a93-0e4b-4f26-8b37-2a9e6c1d5f84', name: 'Menu', alias: 'menu' },
  properties: MENU_PROPERTIES,
}

/** One entry in a menu: a page, media or an address, a label, and items below it. */
export const MENU_ITEM_TYPE: BuiltInContentType = {
  key: SYSTEM_CONTENT_TYPE_KEYS.MenuItem,
  alias: 'menuItem',
  name: 'Menu item',
  description: 'A page, media item or address in a menu, with any items below it.',
  icon: 'icon-link',
  isElement: true,
  tab: { key: '3a8e2d61-9f5c-4b07-a1d4-6c2b8e0f7a35', name: 'Item', alias: 'item' },
  properties: MENU_ITEM_PROPERTIES,
}

export const SYSTEM_CONTENT_TYPES: readonly BuiltInContentType[] = [
  SEO_FIELDS_TYPE,
  CACHE_FIELDS_TYPE,
  MENU_TYPE,
  MENU_ITEM_TYPE,
]

export function systemContentTypeAggregate(def: BuiltInContentType): ContentTypeAggregate {
  return {
    key: def.key,
    alias: def.alias,
    name: def.name,
    description: def.description,
    icon: def.icon,
    allowedAsRoot: false,
    variesByCulture: false,
    variesBySegment: false,
    isElement: def.isElement === true,
    allowedInLibrary: def.allowedInLibrary === true,
    collectionKey: null,
    cleanup: {
      preventCleanup: false,
      keepAllVersionsNewerThanDays: null,
      keepLatestVersionPerDayForDays: null,
    },
    containers: [
      {
        key: def.tab.key,
        name: def.tab.name,
        alias: def.tab.alias,
        type: 'Tab',
        sortOrder: 0,
        parentKey: null,
      },
    ],
    properties: def.properties.map((p, sortOrder) => ({
      key: p.key,
      alias: p.alias,
      name: p.name,
      description: p.description,
      dataTypeKey: p.dataTypeKey,
      containerKey: def.tab.key,
      sortOrder,
      variesByCulture: false,
      variesBySegment: false,
      mandatory: false,
      mandatoryMessage: null,
      regEx: null,
      regExMessage: null,
      labelOnTop: false,
    })),
    compositions: [],
    allowedContentTypes: [],
    allowedComponentKeys: [],
    defaultComponentKey: null,
    parentKey: null,
  }
}

/**
 * Creates any missing system content type by its fixed key; never changes one
 * that exists. Idempotent; runs at every boot.
 */
export async function ensureSystemContentTypes(db: Db): Promise<string[]> {
  const repo = new ContentTypeRepository(db, { kind: 'document' })
  const created: string[] = []
  for (const def of SYSTEM_CONTENT_TYPES) {
    if (await repo.byKey(def.key)) continue
    await repo.save(systemContentTypeAggregate(def))
    created.push(def.alias)
  }
  return created
}
