/**
 * The content-type aggregate: a content type plus its property groups, property
 * types, compositions, allowed children and templates.
 *
 * Kept as one aggregate because the editor saves it as one document, and because
 * the property set is only meaningful together with the compositions it inherits.
 */
export interface PropertyTypeModel {
  key: string
  alias: string
  name: string
  description: string | null
  dataTypeKey: string
  /** The group this property renders in, or null for the generic tab. */
  containerKey: string | null
  sortOrder: number
  variesByCulture: boolean
  variesBySegment: boolean
  mandatory: boolean
  mandatoryMessage: string | null
  regEx: string | null
  regExMessage: string | null
  labelOnTop: boolean
  /** The file's `since`, when written. */
  sinceVersion?: string | null
  /** Set when the element is not yet live on the reading node: the state it goes live in. */
  pending?: { version: string; revision: string } | null
  /** Member types only: shown to the member on their profile. */
  memberCanView?: boolean
  /** Member types only: editable by the member on their profile. */
  memberCanEdit?: boolean
  /** Member types only: hidden from users without sensitive-data access. */
  isSensitive?: boolean
  /**
   * False keeps the property's values out of backoffice search. Absent means
   * unchanged on a save, which is what a backoffice save sends.
   */
  searchable?: boolean
  /**
   * How much the property counts in site search, or false to leave it out.
   * Absent means unchanged on a save, as for `searchable`.
   */
  siteSearch?: SiteSearchLevel | false
}

/** A property's weight in site search; the page name always ranks above all three. */
export type SiteSearchLevel = 'high' | 'normal' | 'low'

export const SITE_SEARCH_LEVELS: readonly SiteSearchLevel[] = ['high', 'normal', 'low']

export interface PropertyGroupModel {
  key: string
  name: string | null
  alias: string | null
  /** 'Tab' or 'Group'; the wire format is a string. */
  type: string
  sortOrder: number
  parentKey: string | null
}

export type CompositionType = 'Composition' | 'Inheritance'

export interface CompositionModel {
  contentTypeKey: string
  compositionType: CompositionType
}

export interface AllowedChildModel {
  contentTypeKey: string
  sortOrder: number
}

export interface CleanupModel {
  preventCleanup: boolean
  keepAllVersionsNewerThanDays: number | null
  keepLatestVersionPerDayForDays: number | null
}

export interface ContentTypeAggregate {
  key: string
  alias: string
  name: string
  description: string | null
  icon: string
  allowedAsRoot: boolean
  variesByCulture: boolean
  variesBySegment: boolean
  isElement: boolean
  allowedInLibrary: boolean
  collectionKey: string | null
  cleanup: CleanupModel
  properties: PropertyTypeModel[]
  containers: PropertyGroupModel[]
  compositions: CompositionModel[]
  allowedContentTypes: AllowedChildModel[]
  allowedComponentKeys: string[]
  defaultComponentKey: string | null
  /** Folder placement in the tree, which is not the composition graph. */
  parentKey: string | null
  sinceVersion?: string | null
  pending?: { version: string; revision: string } | null
  /** False leaves every page of the type out of site search. Absent means unchanged on a save. */
  siteSearch?: boolean
}

/**
 * Umbraco's system media types (`IsSystemMediaType`): always present, not
 * deletable, alias fixed. Keys from its installer.
 */
export const SYSTEM_MEDIA_TYPE_KEYS: Readonly<Record<'Folder' | 'Image' | 'File', string>> = {
  Folder: 'f38bd2d7-65d0-48e6-95dc-87ce06ec2d3d',
  Image: 'cc07b313-0843-4aa8-bbda-871c8da728c8',
  File: '4c52d8ab-54e6-40cd-999c-7a5f24903e4d',
}

/** "Caching" for media (story 057): a composition this CMS ships, never created as an item. */
export const MEDIA_CACHE_FIELDS_TYPE_KEY = '2d7c5e91-4a38-4f06-b1e2-8c9a0f3d6b57'
export const MEDIA_CACHE_KEEP_FOR_PROPERTY_KEY = '6e1d9b47-3a2c-4f85-8b06-d4c7a2e5f193'

export function isSystemMediaType(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    Object.values(SYSTEM_MEDIA_TYPE_KEYS).includes(lower) || lower === MEDIA_CACHE_FIELDS_TYPE_KEY
  )
}

/**
 * Umbraco's one built-in member type, "Member", by the key its installer uses:
 * always present, so a fresh install can create a member without a schema file.
 */
export const SYSTEM_MEMBER_TYPE_KEY = 'd59be02f-1df9-4228-aa1e-01917d806cda'

export function isSystemMemberType(key: string): boolean {
  return key.toLowerCase() === SYSTEM_MEMBER_TYPE_KEY
}

/**
 * Content types this CMS ships: always present, not deletable, alias fixed. A
 * site may add fields to one, but not remove or change the ones it ships with.
 */
export const SYSTEM_CONTENT_TYPE_KEYS: Readonly<
  Record<'SeoFields' | 'CacheFields' | 'Menu' | 'MenuItem', string>
> = {
  SeoFields: '5e0f1c2a-7b3d-4c8e-9a61-0d2b4f6e8a13',
  CacheFields: '7a1e4c93-2b6d-4f58-a0c7-5d3e9b1f8a24',
  Menu: '3c9e2f71-5a4d-4b86-9e13-7f0a2d6c8b45',
  MenuItem: '8b4d1a26-6e3f-4c90-a7d5-2e9c0f4b7a18',
}

export function isSystemContentType(kind: 'document' | 'media' | 'member', key: string): boolean {
  if (kind === 'media') return isSystemMediaType(key)
  if (kind === 'member') return isSystemMemberType(key)
  return Object.values(SYSTEM_CONTENT_TYPE_KEYS).includes(key.toLowerCase())
}

/** A field a system content type ships with, which a site may not remove or change. */
export interface SystemPropertyModel {
  key: string
  alias: string
  name: string
  description: string
  dataTypeKey: string
}

/**
 * The "Search & sharing" composition's own fields. Invariant as shipped: the data
 * layer does not mask a property's variance by the composing type's, so a site
 * that wants per-language values turns variance on in its own file.
 */
export const SEO_FIELDS_PROPERTIES: readonly SystemPropertyModel[] = [
  {
    key: '8d1f3a52-6c0e-4b7a-9e24-1a5c7d9f0b31',
    alias: 'seoTitle',
    name: 'Search title',
    description: 'Shown in search results and browser tabs. Leave empty to use the page name.',
    dataTypeKey: '0cc0eba1-9960-42c9-bf9b-60e150b429ae',
  },
  {
    key: '2b7e9c41-0d5f-4a63-8b18-6e4c2a0f7d52',
    alias: 'seoDescription',
    name: 'Search description',
    description: 'A sentence or two shown under the title in search results and when shared.',
    dataTypeKey: 'c6bac0dd-4ab9-45b1-8e30-e4b619ee5da3',
  },
  {
    key: 'f4a60d83-9e2b-4c15-a7d0-3b8e1f5c9a64',
    alias: 'seoImage',
    name: 'Sharing image',
    description: 'Shown when the page is shared. Leave empty to use the site image.',
    dataTypeKey: 'ad9f0cf2-bda2-45d5-9ea1-a63cfc873fd3',
  },
  {
    key: '6c3b8e14-2f7a-4d90-b5e1-9a0d4c7f2e75',
    alias: 'seoCanonical',
    name: 'Preferred address',
    description:
      'Only when the same content lives at another address search engines should use instead.',
    dataTypeKey: '0cc0eba1-9960-42c9-bf9b-60e150b429ae',
  },
  {
    key: '0e9d5a27-4b1c-4f86-8c32-7d6f0a3e1b86',
    alias: 'seoNoindex',
    name: 'Hide from search engines',
    description: 'Asks search engines to leave this page out of their results.',
    dataTypeKey: '92897bc6-a5f3-4ffe-ae27-f2e7e33dda49',
  },
  {
    key: 'a7f2c6e9-8d4b-4e31-b0a5-2c9e6f1d3a97',
    alias: 'seoSitemapHide',
    name: 'Hide from sitemap',
    description: 'Leaves this page out of the list of pages offered to search engines.',
    dataTypeKey: '92897bc6-a5f3-4ffe-ae27-f2e7e33dda49',
  },
]

/** Where an editor chooses how long copies of a page or media item may be kept (story 057). */
export const CACHE_KEEP_FOR_ALIAS = 'cacheKeepFor'

/** The "Keep copies for" data type: a dropdown of `KEEP_COPIES_FOR` labels. */
export const KEEP_COPIES_FOR_DATA_TYPE_KEY = '4f2b8d61-9c0e-4a73-b5d8-1e6a3c7f9b02'

/** Each choice, as it is stored and shown, and its lifetime in seconds; none chosen is the site's. */
export const KEEP_COPIES_FOR: ReadonlyArray<{ label: string; seconds: number }> = [
  { label: "Don't keep copies", seconds: 0 },
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
]

/** The "Caching" composition's one field, the same for pages and media. */
export const CACHE_FIELDS_PROPERTIES: readonly SystemPropertyModel[] = [
  {
    key: '9b3e6f12-5d8a-4c07-8e41-2f7a0c9d6b13',
    alias: CACHE_KEEP_FOR_ALIAS,
    name: 'Keep copies for',
    description:
      "How long browsers and any service in front of the site may reuse a copy before asking again. Leave empty for the site's usual setting.",
    dataTypeKey: KEEP_COPIES_FOR_DATA_TYPE_KEY,
  },
]

/** The fields a system content type ships with, by the type's key. */
export function systemContentTypeProperties(key: string): readonly SystemPropertyModel[] {
  const lower = key.toLowerCase()
  if (lower === SYSTEM_CONTENT_TYPE_KEYS.SeoFields) return SEO_FIELDS_PROPERTIES
  if (lower === SYSTEM_CONTENT_TYPE_KEYS.CacheFields) return CACHE_FIELDS_PROPERTIES
  if (lower === SYSTEM_CONTENT_TYPE_KEYS.Menu) return MENU_PROPERTIES
  if (lower === SYSTEM_CONTENT_TYPE_KEYS.MenuItem) return MENU_ITEM_PROPERTIES
  return []
}

/**
 * Why a change to a system content type's fields is refused, or undefined when
 * it keeps every shipped field's key, alias and data type. Fields may be added,
 * relabelled, moved, and switched to vary by culture.
 */
export function systemFieldViolation(
  key: string,
  properties: ReadonlyArray<{ key: string; alias: string; dataTypeKey: string }>,
): string | undefined {
  for (const shipped of systemContentTypeProperties(key)) {
    const found = properties.find((p) => p.key.toLowerCase() === shipped.key)
    if (
      !found ||
      found.alias !== shipped.alias ||
      found.dataTypeKey.toLowerCase() !== shipped.dataTypeKey
    )
      return `The '${shipped.name}' field is provided by Crombolo and cannot be removed or changed. You can add your own fields beside it.`
  }
  return undefined
}

/** How the editor labels a pending element. */
export function pendingLabel(until: { version: string }): string {
  return `goes live in ${until.version}`
}

export interface DataTypeModel {
  key: string
  /** Schema files reference a data type by this; Umbraco itself has only key and name. */
  alias: string | null
  name: string
  editorAlias: string
  editorUiAlias: string | null
  /** One of ValueStorageType. */
  dbType: string
  values: Array<{ alias: string; value: unknown }>
  parentKey: string | null
}

export interface ComponentModel {
  key: string
  name: string
  alias: string
  content: string | null
  /** Derived from `export const layout = '…'` in the view; the tree hangs children under it. */
  masterKey?: string | null
}

/** One entry in a backoffice tree. */
export interface TreeItem {
  key: string
  name: string
  hasChildren: boolean
  parentKey: string | null
  icon: string | null
  isFolder: boolean
  isElement?: boolean
  editorUiAlias?: string | null
  /** The content type of a blueprint in the blueprint tree. */
  contentTypeKey?: string | null
}

export interface Page<T> {
  total: number
  items: T[]
}

/** A menu's "Alias", which templates name it by: `menu('header')` (story 141). */
export const MENU_ALIAS_PROPERTY = 'alias'

/** The "Menu items" data type: a block list of menu items, nested in each item too. */
export const MENU_ITEMS_DATA_TYPE_KEY = '5d2a8f47-1c6b-4e93-b0f4-8a3e7c2d9f61'

/** The "Menu link" data type: one page, media item or address. */
export const MENU_LINK_DATA_TYPE_KEY = '1f7c3b95-8d2e-4a64-9c0b-6e5d4a2f8c37'

/** The Menu element type's own fields. */
export const MENU_PROPERTIES: readonly SystemPropertyModel[] = [
  {
    key: '0a6f4d38-2c9b-4e71-8f5a-3d1b7e9c4a62',
    alias: MENU_ALIAS_PROPERTY,
    name: 'Alias',
    description:
      "What templates call this menu, such as header. Left empty, it is made from the menu's name when saved; renaming the menu later does not change it.",
    dataTypeKey: '0cc0eba1-9960-42c9-bf9b-60e150b429ae',
  },
  {
    key: '6e2b9c41-7f3a-4d58-b1c6-9a0e5d8f2b73',
    alias: 'items',
    name: 'Items',
    description: 'Drag to reorder. Each item can hold items of its own.',
    dataTypeKey: MENU_ITEMS_DATA_TYPE_KEY,
  },
]

/** The Menu item element type's fields. */
export const MENU_ITEM_PROPERTIES: readonly SystemPropertyModel[] = [
  {
    key: '4c8a1e57-3b6d-4f92-a0e8-7d2c5b9f1a84',
    alias: 'link',
    name: 'Link',
    description:
      'A page, a media item or an address. Leave it empty for a heading that only holds the items below it.',
    dataTypeKey: MENU_LINK_DATA_TYPE_KEY,
  },
  {
    key: '9d3f6b28-1a7e-4c05-b8d2-5e4a0c7f3b95',
    alias: 'label',
    name: 'Label',
    description: "Shown instead of the page's name. Needed when there is no link.",
    dataTypeKey: '0cc0eba1-9960-42c9-bf9b-60e150b429ae',
  },
  {
    key: '2b7e0c64-8f1d-4a39-9c5e-6a3d8b1f4e06',
    alias: 'children',
    name: 'Items below',
    description: 'Shown under this item, as a submenu.',
    dataTypeKey: MENU_ITEMS_DATA_TYPE_KEY,
  },
]

/**
 * An alias made from a name as Umbraco's `ToSafeAlias` makes one: letters and
 * digits only, words joined in camelCase, starting with a lowercase letter.
 * "Main navigation" becomes `mainNavigation`. Pure.
 */
export function safeAlias(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const joined = words
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('')
  return joined.replace(/^[0-9]+/, '')
}
