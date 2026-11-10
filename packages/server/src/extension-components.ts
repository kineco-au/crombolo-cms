/**
 * An extension's components, rendered in its own process (story 312). The page,
 * its layouts and the site's components render here; when the render reaches one
 * an extension owns, `<id>/<name>`, that one component is a `render` call to the
 * extension, and its HTML goes in its place. docs/extensions.md, "Components".
 */
import {
  type ComponentModule,
  markPersonal,
  PublishedContent,
  PublishedElement,
  RawHtml,
} from '@crombolo/render'
import type { BundleLog } from './bundles.ts'
import type { ExtensionProcess } from './extension-process.ts'

/** One extension whose components may render: its process, and what it may do now. */
export interface ExtensionComponentSource {
  process: ExtensionProcess
  /** What it may use now, from its grant; `templates` is what lets it render. */
  granted(): readonly string[]
  /** The site layout its page templates sit in: its `layout` setting. */
  layout(): string | undefined
  log: BundleLog
}

export interface ExtensionComponents {
  /** The component `<id>/<name>` as a module the renderer runs, or undefined when none is. */
  module(alias: string): ComponentModule | undefined
  /** The layout each extension's `layout` setting names, where one does. */
  layouts(): { id: string; layout: string }[]
  /** Every component the extensions offer, as `<id>/<name>` with the extension's name: for the template picker. */
  listed(): { alias: string; extension: string }[]
}

const BLOCKS = 'blocks/'

/** How many pages and elements one render sends with their values; past it, values are calls. */
const VALUES_PER_RENDER = 200

/**
 * The values sent with each page and element a render lends, so the component
 * reads them synchronously, as a site component does (story 312).
 */
function valuesSender(): (value: object) => Record<string, unknown> | undefined {
  let left = VALUES_PER_RENDER
  return (value) => {
    if (!(value instanceof PublishedContent || value instanceof PublishedElement)) return undefined
    if (left <= 0) return undefined
    left -= 1
    const values: Record<string, unknown> = {}
    for (const { alias } of value.properties) {
      if (alias in values) continue
      try {
        values[alias] = {
          value: value.value(alias),
          text: value.text(alias),
          html: value.html(alias),
        }
      } catch {
        // Left to a call, which says what went wrong.
      }
    }
    return { $values: values }
  }
}

export function createExtensionComponents(
  sources: readonly ExtensionComponentSource[],
  options: { timeoutMs?: number } = {},
): ExtensionComponents {
  const byId = new Map(sources.map((source) => [source.process.id, source]))
  const warned = new Set<string>()
  const offers = (source: ExtensionComponentSource, name: string) =>
    source.process.description?.components?.some((component) => component.name === name) ?? false

  const render = async (
    source: ExtensionComponentSource,
    name: string,
    props: Record<string, unknown>,
  ): Promise<RawHtml> => {
    const id = source.process.id
    if (!source.granted().includes('templates')) {
      if (!warned.has(id)) {
        warned.add(id)
        source.log.warn(
          'The extension {id} was not granted templates, so its component {name} renders nothing.',
          { id, name },
        )
      }
      return new RawHtml('')
    }
    // A signed-in member may change what it renders, and its code cannot be read
    // for `member` as a view's can: such a page is not shared.
    if (props.member !== undefined) markPersonal()
    const { searchParams, ...rest } = props
    try {
      const { value } = await source.process.call(
        'render',
        { name },
        // Read only if the component asks, since reading them makes the page personal.
        { ...rest, readSearchParams: () => searchParams },
        { timeoutMs: options.timeoutMs ?? 10_000, extra: valuesSender() },
      )
      return new RawHtml(typeof value === 'string' ? value : '')
    } catch (error) {
      source.log.error('The extension {id} could not render {name}: {error}', {
        id,
        name,
        error: error instanceof Error ? error.message : String(error),
      })
      return new RawHtml('')
    }
  }

  // The layout the administrator chose, else the one the component suggests: a
  // site without that layout renders the body on its own.
  const moduleFor = (source: ExtensionComponentSource, name: string): ComponentModule => ({
    default: ((props: Record<string, unknown>) => render(source, name, props)) as never,
    layout:
      source.layout() ??
      source.process.description?.components?.find((component) => component.name === name)?.layout,
  })

  return {
    module(alias) {
      // A block's component is found by its element type's alias, in whichever
      // extension offers it.
      if (alias.startsWith(BLOCKS)) {
        const name = alias
        const source = sources.find((candidate) => offers(candidate, name))
        return source ? moduleFor(source, name) : undefined
      }
      const slash = alias.indexOf('/')
      if (slash < 1) return undefined
      const source = byId.get(alias.slice(0, slash))
      const name = alias.slice(slash + 1)
      return source && offers(source, name) ? moduleFor(source, name) : undefined
    },
    layouts() {
      return sources.flatMap((source) => {
        const layout = source.layout()
        return layout ? [{ id: source.process.id, layout }] : []
      })
    },
    listed() {
      return sources.flatMap((source) =>
        (source.process.description?.components ?? [])
          .filter((component) => !component.name.startsWith(BLOCKS))
          .map((component) => ({
            alias: `${source.process.id}/${component.name}`,
            extension: source.process.name,
          })),
      )
    },
  }
}
