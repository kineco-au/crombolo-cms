/**
 * The first file, and the repetitive edit.
 *
 * Schema-as-code means a type is a TOML file somebody writes — which leaves a
 * new site with nothing to copy from, and leaves adding a property a matter of
 * remembering the vocabulary and inventing a uuid. These build the model; the
 * canonical writer turns it into the file, so what the CLI writes is byte for
 * byte what `types rewrite` would.
 */
import type { SchemaForm, SchemaFormField, SchemaWorkflow } from '@crombolo/core'
import { pascal } from './generate.ts'
import type { SchemaContentType, SchemaProperty, SchemaTab, SchemaTypeKind } from './model.ts'
import { allProperties } from './model.ts'

/** `articlePage` → `Article Page`, which is what the backoffice shows. */
export function nameFor(alias: string): string {
  const spaced = alias
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface NewTypeOptions {
  alias: string
  kind?: SchemaTypeKind
  name?: string
  description?: string
  icon?: string
  /** Content types only: may a page of this type sit at the root of the tree. */
  allowAtRoot?: boolean
  /** An element type: content with no URL, created in the Library. */
  element?: boolean
  /** Content types only: declare `components`/`default-component` for a view of its own. */
  template?: boolean
  /** The tab the scaffolded `title` goes in; absent means no properties at all. */
  tab?: string
  /** Aliases of the types it is composed of. */
  compose?: string[]
  /** Content types only: the aliases of the types allowed beneath it. */
  allowChildren?: string[]
  variesByCulture?: boolean
  variesBySegment?: boolean
  /** May it be created in the Library; elements always may. */
  library?: boolean
  /** Content types only: its children shown as a list, with this data type. */
  listView?: string
}

const DEFAULT_ICONS: Record<SchemaTypeKind, string> = {
  document: 'icon-document',
  media: 'icon-picture',
  member: 'icon-user',
}

/** A type as a new site would write it: no keys (sync derives them, story 161), nothing else assumed. */
export function newType(
  options: NewTypeOptions,
  key: () => string | undefined = () => undefined,
): SchemaContentType {
  const kind = options.kind ?? 'document'
  const element = options.element === true
  // An element has no URL, so a template would never be used; neither has a
  // media or member type, which is why the vocabulary has no room for one.
  const templated = kind === 'document' && !element && options.template !== false
  const tabs: SchemaTab[] =
    options.tab === undefined
      ? []
      : [
          {
            name: options.tab,
            properties: [
              {
                key: key(),
                alias: 'title',
                name: 'Title',
                // An element has no page, so it has no heading either.
                description: element ? undefined : 'Shown as the page heading',
                type: 'textstring',
                mandatory: true,
                variesByCulture: options.variesByCulture === true,
                variesBySegment: options.variesBySegment === true,
                labelOnTop: false,
              },
            ],
            groups: [],
          },
        ]
  return {
    key: key(),
    alias: options.alias,
    name: options.name ?? nameFor(options.alias),
    description: options.description,
    icon: options.icon ?? DEFAULT_ICONS[kind],
    allowAtRoot: kind === 'document' ? options.allowAtRoot === true : false,
    isElement: element,
    allowInLibrary: element || options.library === true,
    variesByCulture: options.variesByCulture === true,
    variesBySegment: options.variesBySegment === true,
    compositions: options.compose ?? [],
    allowChildren: kind === 'document' ? (options.allowChildren ?? []) : [],
    components: templated ? [options.alias] : [],
    defaultComponent: templated ? options.alias : undefined,
    collection: kind === 'document' ? options.listView : undefined,
    cleanup: { prevent: false },
    properties: [],
    tabs,
  }
}

export interface AddPropertyOptions {
  alias: string
  /** A data type alias: built in, or one of `schema/data-types/`. */
  type: string
  name?: string
  description?: string
  mandatory?: boolean
  /** Which tab to put it in; the first existing one, else `Content`. */
  tab?: string
}

export type AddPropertyResult =
  | { ok: true; type: SchemaContentType; tab: string; property: SchemaProperty }
  | { ok: false; reason: string }

/**
 * Appends a property, at the end of a tab, because order in the file is order
 * in the editor. Nothing is removed and nothing is reordered: this is an edit a
 * person should be able to read in a diff.
 */
export function addProperty(
  type: SchemaContentType,
  options: AddPropertyOptions,
  key: () => string | undefined = () => undefined,
): AddPropertyResult {
  if (allProperties(type).some((p) => p.alias === options.alias))
    return { ok: false, reason: `"${type.alias}" already has a property "${options.alias}"` }

  const property: SchemaProperty = {
    key: key(),
    alias: options.alias,
    name: options.name ?? nameFor(options.alias),
    description: options.description,
    type: options.type,
    mandatory: options.mandatory === true,
    variesByCulture: false,
    variesBySegment: false,
    labelOnTop: false,
  }

  const wanted = options.tab ?? type.tabs[0]?.name ?? 'Content'
  const existing = type.tabs.find((tab) => tab.name === wanted)
  const tabs = existing
    ? type.tabs.map((tab) =>
        tab === existing ? { ...tab, properties: [...tab.properties, property] } : tab,
      )
    : [...type.tabs, { name: wanted, properties: [property], groups: [] }]
  return { ok: true, type: { ...type, tabs }, tab: wanted, property }
}

const field = (
  alias: string,
  type: string,
  caption: string,
  autocomplete: string,
): SchemaFormField => ({
  alias,
  type,
  caption,
  mandatory: true,
  sensitive: false,
  autocomplete,
  values: [],
  accept: [],
})

/** A form to start from (story 161): one page asking for a name and an email address, kept as entries. */
export function newForm(alias: string, name?: string): SchemaForm {
  return {
    alias,
    name: name ?? nameFor(alias),
    storeEntries: true,
    requiresApproval: false,
    honeypot: true,
    pages: [
      {
        groups: [
          {
            columns: 1,
            fields: [
              field('name', 'shortAnswer', 'Name', 'name'),
              field('email', 'email', 'Email', 'email'),
            ],
          },
        ],
      },
    ],
    workflows: [],
  }
}

export interface NewWorkflowOptions {
  alias: string
  name?: string
  /** The content types it covers, by alias. */
  contentTypes?: string[]
  /** The user groups who approve, by alias; editors when absent. */
  approvers?: string[]
}

/** An approval workflow to start from (story 161): one stage, approved by one of its approvers. */
export function newWorkflow(options: NewWorkflowOptions): SchemaWorkflow {
  return {
    alias: options.alias,
    name: options.name ?? nameFor(options.alias),
    appliesTo: { branches: [], contentTypes: options.contentTypes ?? [] },
    publishersMaySkip: true,
    onEdit: 'withdraw',
    selfApproval: 'refused',
    comments: 'optional',
    unpublish: false,
    onChange: 'keep',
    stages: [
      {
        alias: 'approval',
        name: 'Approval',
        approvers: options.approvers ?? ['editor'],
        required: 'one',
        next: [],
        sendBack: 'editor',
      },
    ],
  }
}

/**
 * A block's component (story 184): `components/blocks/<alias>.tsx`, which
 * `<Blocks>` renders an element type's blocks with, typed by the interface
 * `crombolo generate` writes for it.
 */
export function blockScaffold(type: SchemaContentType): string {
  const name = pascal(type.alias)
  const shown = allProperties(type).find(
    (property) => property.type === 'textstring' || property.type === 'textarea',
  )
  const body = shown ? `{content.text('${shown.alias}')}` : `{content.contentType.alias}`
  return `import type { BlockProps } from '@crombolo/crombolo'
import type { ${name} } from '../../schema/content-types'

export default function ${name}Block({ content }: BlockProps<${name}>) {
  return <div class="block-${type.alias}">${body}</div>
}
`
}

/** The view a scaffolded content type points at, if it has not got one yet. */
export function viewScaffold(type: SchemaContentType): string {
  const rendered = allProperties(type)
    .filter((property) => property.type === 'textstring' || property.type === 'textarea')
    .slice(0, 2)
  const body = rendered
    .map((property) =>
      property.alias === 'title'
        ? `        <h1>{model.text('title')}</h1>`
        : `        <p>{model.text('${property.alias}')}</p>`,
    )
    .join('\n')
  return `import type { PageProps } from '@crombolo/crombolo'

export default function ${nameFor(type.alias).replace(/\s+/g, '')}({ model }: PageProps) {
  return (
    <html lang="en">
      <body>
${body || `        <h1>{model.name}</h1>`}
      </body>
    </html>
  )
}
`
}
