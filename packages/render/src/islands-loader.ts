/**
 * The island loader, served at `/crombolo/islands.js` (story 209). It finds
 * every `<crombolo-island>`, waits for its `data-load` condition, imports its
 * module through the generation's manifest, and mounts it: a client
 * component with React, an `<Island>` module through its `mount` function.
 *
 * Written as a function and served as its source, so a test can run it with
 * stand-ins for the browser. A file, never inline, so a page with islands
 * works under `script-src 'self'`.
 */

/** What the loader needs from the browser. */
export interface LoaderEnvironment {
  document: {
    querySelector(selector: string): { getAttribute(name: string): string | null } | null
    querySelectorAll(selector: string): ArrayLike<IslandElement>
  }
  importModule(url: string): Promise<Record<string, unknown>>
  fetchJson(url: string): Promise<IslandManifest>
  IntersectionObserver?: new (
    callback: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void,
    options?: { rootMargin?: string },
  ) => { observe(target: unknown): void; unobserve(target: unknown): void }
  requestIdleCallback?: (callback: () => void) => void
  setTimeout(callback: () => void, ms: number): unknown
  console: { error(...values: unknown[]): void }
}

/** The element an island renders as, as far as the loader touches it. */
export interface IslandElement {
  dataset: Record<string, string | undefined>
  querySelector(selector: string): { textContent: string | null; innerHTML: string } | null
  cloneNode(deep: boolean): {
    querySelectorAll(selector: string): ArrayLike<{ remove(): void }>
    innerHTML: string
  }
  replaceChildren(): void
}

/** What a generation's build, or a Vite manifest made over, says: where each island's code is. */
export interface IslandManifest {
  /** The module that mounts a React component: `mount(Component, element, props, childrenHtml)`. */
  react?: string
  modules: Record<string, string>
}

export function islandLoader(env: LoaderEnvironment): void {
  const meta = env.document.querySelector('meta[name="crombolo-islands"]')
  const manifestUrl = meta?.getAttribute('content')
  if (!manifestUrl) return
  let manifest: Promise<IslandManifest> | undefined
  const modules = new Map<string, Promise<Record<string, unknown>>>()
  const load = (url: string) => {
    let pending = modules.get(url)
    if (!pending) {
      pending = env.importModule(url)
      modules.set(url, pending)
    }
    return pending
  }

  /** What the server rendered as the island's content, less its props and carried children. */
  const shownHtml = (element: IslandElement): string => {
    const copy = element.cloneNode(true)
    const extras = copy.querySelectorAll(
      ':scope > script[type="application/json"], :scope > template[data-children]',
    )
    for (let i = 0; i < extras.length; i++) extras[i]?.remove()
    return copy.innerHTML
  }

  const mount = async (element: IslandElement): Promise<void> => {
    if (element.dataset.mounted) return
    element.dataset.mounted = 'true'
    const name = element.dataset.module ?? '?'
    try {
      manifest ??= env.fetchJson(manifestUrl)
      const built = await manifest
      const url = built.modules[name]
      if (!url) throw new Error(`no browser code was built for it`)
      const props = JSON.parse(
        element.querySelector(':scope > script[type="application/json"]')?.textContent || '{}',
      ) as Record<string, unknown>
      const mode = element.dataset.children
      const childrenHtml =
        mode === 'template'
          ? (element.querySelector(':scope > template[data-children]')?.innerHTML ?? null)
          : mode === 'inline'
            ? shownHtml(element)
            : null
      const module = await load(url)
      if (element.dataset.kind === 'mount') {
        const mountIt = module.default as (target: unknown, props: unknown) => unknown
        element.replaceChildren()
        await mountIt(element, props)
        return
      }
      if (!built.react) throw new Error('the React mount module was not built')
      const react = await load(built.react)
      const component = module[element.dataset.export ?? 'default']
      if (typeof component !== 'function')
        throw new Error(`it has no export "${element.dataset.export}"`)
      ;(react.mount as (c: unknown, e: unknown, p: unknown, h: string | null) => void)(
        component,
        element,
        props,
        childrenHtml,
      )
    } catch (error) {
      // Its fallback stays; nothing else on the page is touched.
      env.console.error(`The island ${name} could not load:`, error)
    }
  }

  const islands = env.document.querySelectorAll('crombolo-island')
  let observer: InstanceType<NonNullable<LoaderEnvironment['IntersectionObserver']>> | undefined
  for (let i = 0; i < islands.length; i++) {
    const element = islands[i] as IslandElement
    const when = element.dataset.load
    if (when === 'load') void mount(element)
    else if (when === 'idle') {
      const later = () => void mount(element)
      if (env.requestIdleCallback) env.requestIdleCallback(later)
      else env.setTimeout(later, 200)
    } else if (env.IntersectionObserver) {
      observer ??= new env.IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              observer?.unobserve(entry.target)
              void mount(entry.target as IslandElement)
            }
        },
        { rootMargin: '200px' },
      )
      observer.observe(element)
    } else void mount(element)
  }
}

/** The script `/crombolo/islands.js` serves. */
export const ISLAND_LOADER_SCRIPT = `/* crombolo islands (story 209) */
(${islandLoader.toString()})({
  document,
  importModule: (url) => import(url),
  fetchJson: (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + ' for ' + url); return r.json() }),
  IntersectionObserver: window.IntersectionObserver,
  requestIdleCallback: window.requestIdleCallback ? window.requestIdleCallback.bind(window) : undefined,
  setTimeout: window.setTimeout.bind(window),
  console,
})
`
