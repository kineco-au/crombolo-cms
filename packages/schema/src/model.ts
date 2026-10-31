import type { SchemaForm, SchemaWorkflow, SiteSearchLevel } from '@crombolo/core'
import type { SchemaUserGroup } from './user-groups.ts'

/**
 * The schema-as-code model: what a site's `schema/*.toml` files describe.
 * The shapes mirror the TOML vocabulary in docs/schema-as-code.md, with
 * defaults applied, so the rest of the system never sees a missing key.
 */
export interface SchemaProperty {
  key?: string
  alias: string
  name: string
  description?: string
  notes?: string
  /** A data type alias, built in or defined in `schema/data-types/`. */
  type: string
  mandatory: boolean
  mandatoryMessage?: string
  regex?: string
  regexMessage?: string
  variesByCulture: boolean
  variesBySegment: boolean
  labelOnTop: boolean
  /** Member types only: shown to the member on their profile. */
  memberCanView?: boolean
  /** Member types only: editable by the member on their profile. */
  memberCanEdit?: boolean
  /** Member types only: hidden from users without sensitive-data access. */
  sensitive?: boolean
  /** False keeps the property's values out of backoffice search; searchable when absent. */
  searchable?: boolean
  /** Its weight in site search, or false to leave it out; `normal` when absent. */
  siteSearch?: SiteSearchLevel | false
  /** Fills existing content when a required property is added to a type with pages. */
  default?: unknown
  since?: string
}

export interface SchemaGroup {
  name: string
  alias?: string
  properties: SchemaProperty[]
}

export interface SchemaTab {
  name: string
  alias?: string
  properties: SchemaProperty[]
  groups: SchemaGroup[]
}

export interface SchemaCleanup {
  prevent: boolean
  keepAllNewerThanDays?: number
  keepLatestPerDayForDays?: number
}

export interface SchemaContentType {
  key?: string
  alias: string
  name: string
  description?: string
  notes?: string
  icon: string
  allowAtRoot: boolean
  isElement: boolean
  allowInLibrary: boolean
  variesByCulture: boolean
  variesBySegment: boolean
  compositions: string[]
  allowChildren: string[]
  components: string[]
  defaultComponent?: string
  collection?: string
  /** Tree placement in the backoffice, `A/B`; not part of the type's meaning. */
  folder?: string
  cleanup: SchemaCleanup
  since?: string
  /** False leaves every page of the type out of site search. */
  siteSearch?: false
  /** A site's settings (story 058): its page, a root's direct child, has no address. */
  siteSettings?: true
  /** Properties outside any tab. */
  properties: SchemaProperty[]
  /** Groups outside any tab — `[[group]]`; Umbraco's built-in media types use one. */
  groups?: SchemaGroup[]
  tabs: SchemaTab[]
}

export interface SchemaDataType {
  key?: string
  alias: string
  name: string
  notes?: string
  editor: string
  editorUi?: string
  folder?: string
  config: Record<string, unknown>
  /** A block editor's blocks as `[[data-type.block]]` tables (story 161). */
  blocks?: SchemaBlock[]
  since?: string
}

/** One block a block list, block grid or rich-text editor offers (story 161). */
export interface SchemaBlock {
  /** The element type's alias. */
  element: string
  /** The settings element type's alias. */
  settings?: string
  label?: string
  size?: string
  background?: string
  iconColor?: string
  thumbnail?: string
  /** A group's name; blocks of one group sit together in the picker. */
  group?: string
  /** Grid only. */
  allowAtRoot?: boolean
  allowInAreas?: boolean
  columnSpans?: number[]
  rowSpan?: { min?: number; max?: number }
  areaColumns?: number
  areas?: SchemaBlockArea[]
}

/** An area inside a grid block, and what may be placed in it. */
export interface SchemaBlockArea {
  alias: string
  columnSpan?: number
  rowSpan?: number
  createLabel?: string
  min?: number
  max?: number
  allow?: SchemaBlockAllowance[]
}

/** An element, or a group of blocks, allowed in an area, with optional limits. */
export interface SchemaBlockAllowance {
  element?: string
  group?: string
  min?: number
  max?: number
}

export interface SchemaLanguage {
  iso: string
  name: string
  default: boolean
  mandatory: boolean
  fallback?: string
}

export interface SchemaSet {
  /** From schema/schema.toml; "0" when the file is absent. */
  version: string
  contentTypes: SchemaContentType[]
  /** `schema/media-types/*.toml`: the same vocabulary under `[media-type]`, without templates or cleanup. */
  mediaTypes?: SchemaContentType[]
  /** `schema/member-types/*.toml`: under `[member-type]`, no templates, cleanup or allowed children. */
  memberTypes?: SchemaContentType[]
  dataTypes: SchemaDataType[]
  languages: SchemaLanguage[]
  /** `schema/forms/*.toml` — form definitions; see `docs/forms.md`. */
  forms?: SchemaForm[]
  /** `[urls]` in schema/schema.toml; Umbraco's defaults when absent. */
  urls?: SchemaUrls
  /** `schema/workflows/*.toml` — approval workflows; see `docs/workflows.md`. */
  workflows?: SchemaWorkflow[]
  /** `schema/user-groups/*.toml` — the user groups the site declares (story 228). */
  userGroups?: SchemaUserGroup[]
}

/** How URLs are built, as Umbraco's `Umbraco:CMS:Global` settings set it. */
export interface SchemaUrls {
  /** `HideTopLevelNodeFromPath`: true, the default, leaves the top-level page out of paths. */
  hideTopLevel: boolean
}

/** A problem found while parsing or validating, always locatable. */
export interface SchemaProblem {
  file: string
  /** A dotted path into the file, e.g. `tab[1].property[0].type`. */
  path: string
  message: string
}

/** Which kind of content type a file defines. */
export type SchemaTypeKind = 'document' | 'media' | 'member'

/** The table header and directory for each kind. */
export const TYPE_KIND_FILES: Record<SchemaTypeKind, { header: string; dir: string }> = {
  document: { header: 'content-type', dir: 'content-types' },
  media: { header: 'media-type', dir: 'media-types' },
  member: { header: 'member-type', dir: 'member-types' },
}

/** The files-map key for a type: content types by bare alias, others prefixed. */
export function typeFileKey(kind: SchemaTypeKind, alias: string): string {
  return kind === 'document' ? alias : `${TYPE_KIND_FILES[kind].header}:${alias}`
}

export class SchemaError extends Error {
  constructor(readonly problems: SchemaProblem[]) {
    super(
      `${problems.length} schema problem${problems.length === 1 ? '' : 's'}:\n` +
        problems.map((p) => `  ${p.file}: ${p.path ? `${p.path}: ` : ''}${p.message}`).join('\n'),
    )
  }
}

/** Every property of a type, including tabbed and grouped ones, in editor order. */
export function allProperties(type: SchemaContentType): SchemaProperty[] {
  const out = [...type.properties]
  for (const group of type.groups ?? []) out.push(...group.properties)
  for (const tab of type.tabs) {
    out.push(...tab.properties)
    for (const group of tab.groups) out.push(...group.properties)
  }
  return out
}
