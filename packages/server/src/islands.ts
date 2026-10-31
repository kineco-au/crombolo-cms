/**
 * The browser code for a generation's islands (story 209), built when the
 * generation is taken and served beside it, so a page and its islands always
 * match. Or, with `islands.manifest`, the files a site's own Vite build wrote.
 * docs/rendering.md, "Islands".
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { ISLANDS_DIR, ISLANDS_PATH, type IslandManifest } from '@crombolo/render'

/** What a client module may not import: code that only runs on the server. */
const SERVER_ONLY =
  /^(@crombolo\/(crombolo|render|server|core|data|content|auth|schema|transfer|api-delivery|api-management)(\/.*)?|#actions\/.*|node:.*|bun(:.*)?)$/
/** Whether a client module importing this would pull server code into the browser. */
export const isServerOnly = (specifier: string): boolean =>
  SERVER_ONLY.test(specifier) && specifier !== BROWSER_ENTRY

/** The one part of `@crombolo/crombolo` a browser runs: React's mount. */
const BROWSER_ENTRY = '@crombolo/crombolo/islands-react'

const toKey = (path: string) => path.split(sep).join('/')
const scanner = new Bun.Transpiler({ loader: 'tsx' })

/** `components/client/<name>.ts`: modules an `<Island>` mounts. */
function mountModules(dir: string): string[] {
  const root = join(dir, 'client')
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.[jt]sx?$/.test(entry.name)) out.push(toKey(relative(dir, path)))
    }
  }
  walk(root)
  return out
}

/** `client/species-map.ts` as an `<Island>` names it: `client/species-map`. */
const moduleId = (key: string, client: Set<string>) =>
  client.has(key) ? key : key.replace(/\.[jt]sx?$/, '')

/**
 * Bundles a generation's client modules and `<Island>` modules with React's
 * mount, into `<generation>/.islands/out/` with `manifest.json`. Throws with
 * every problem, each naming its file, when the build fails.
 */
export async function buildIslands(generation: {
  dir: string
  hash: string
  transformed: string[]
  development: boolean
}): Promise<IslandManifest | undefined> {
  const { dir, hash } = generation
  const client = new Set(generation.transformed)
  const mounts = mountModules(dir)
  if (client.size === 0 && mounts.length === 0) return undefined
  const islands = join(dir, ISLANDS_DIR)
  const out = join(islands, 'out')
  if (existsSync(join(out, 'manifest.json')))
    return JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as IslandManifest
  mkdirSync(islands, { recursive: true })
  const reactEntry = join(islands, 'react-mount.ts')
  if (client.size > 0) writeFileSync(reactEntry, `export { mount } from '${BROWSER_ENTRY}'\n`)

  const entries = [
    ...[...client].map((key) => join(dir, ...key.split('/'))),
    ...mounts.map((key) => join(dir, ...key.split('/'))),
    ...(client.size > 0 ? [reactEntry] : []),
  ]
  const keyOf = (path: string) => toKey(relative(dir, path))
  const refused: string[] = []
  const result = await Bun.build({
    entrypoints: entries,
    outdir: out,
    root: dir,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: !generation.development,
    naming: { entry: '[dir]/[name]-[hash].[ext]', chunk: 'chunks/[name]-[hash].[ext]' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(generation.development ? 'development' : 'production'),
    },
    throw: false,
    plugins: [
      {
        name: 'crombolo-islands',
        setup(build) {
          // A client module's snapshot copy is its server stub; the browser gets its source.
          build.onLoad({ filter: /\.[jt]sx?$/ }, (args) => {
            const key = keyOf(args.path)
            if (key.startsWith('..') || !client.has(key)) return undefined
            const source = readFileSync(join(islands, 'src', ...key.split('/')), 'utf8')
            // From the source too: the bundler drops an unused import before resolving it.
            for (const specifier of scanner.scanImports(source))
              if (isServerOnly(specifier.path))
                refused.push(
                  `components/${key} imports ${specifier.path}, which only runs on the server. A 'use client' component cannot use it.`,
                )
            const pragma = /@jsxImportSource\s/.test(source)
              ? ''
              : '/** @jsxImportSource react */\n'
            return { contents: `${pragma}${source}`, loader: key.endsWith('x') ? 'tsx' : 'ts' }
          })
          build.onResolve({ filter: SERVER_ONLY }, (args) => {
            if (args.path === BROWSER_ENTRY) return undefined
            const from = keyOf(args.importer)
            refused.push(
              `components/${from} imports ${args.path}, which only runs on the server. A 'use client' component cannot use it.`,
            )
            return { path: args.path, external: true }
          })
        },
      },
    ],
  })
  if (refused.length > 0) throw new Error([...new Set(refused)].join('\n'))
  if (!result.success)
    throw new Error(
      result.logs
        .map((log) => String(log.message ?? log).replaceAll(`${dir}${sep}`, 'components/'))
        .join('\n'),
    )

  const urlOf = (path: string) => `${ISLANDS_PATH}/${hash}/${toKey(relative(out, path))}`
  const manifest: IslandManifest = { modules: {} }
  for (const output of result.outputs) {
    if (output.kind !== 'entry-point') continue
    const built = toKey(relative(out, output.path)).replace(/-[a-z0-9]+\.js$/, '')
    if (built === `${ISLANDS_DIR}/react-mount`) {
      manifest.react = urlOf(output.path)
      continue
    }
    const source = entries.map(keyOf).find((key) => key.replace(/\.[jt]sx?$/, '') === built)
    if (source) manifest.modules[moduleId(source, client)] = urlOf(output.path)
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}

/** Where a generation's built file lives on disk, or undefined for a path outside it. */
export function builtIslandFile(cacheDir: string, hash: string, path: string): string | undefined {
  if (!/^[0-9a-f]{16}$/.test(hash)) return undefined
  if (!path || path.split('/').some((part) => part === '' || part === '.' || part === '..'))
    return undefined
  const file = join(cacheDir, hash, ISLANDS_DIR, 'out', ...path.split('/'))
  return existsSync(file) ? file : undefined
}

/** A site's Vite manifest, made over into Crombolo's, with files served from `/crombolo/islands/vite/`. */
export function viteIslandManifest(siteDir: string, manifestPath: string): IslandManifest {
  const file = resolve(siteDir, manifestPath)
  const vite = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    { file: string; src?: string; isEntry?: boolean }
  >
  const manifest: IslandManifest = { modules: {} }
  for (const [key, entry] of Object.entries(vite)) {
    const source = (entry.src ?? key).replace(/^\.\//, '')
    const url = `${ISLANDS_PATH}/vite/${entry.file}`
    if (/islands-react\.[jt]sx?$/.test(source)) manifest.react = url
    else if (source.startsWith('components/client/'))
      manifest.modules[source.slice('components/'.length).replace(/\.[jt]sx?$/, '')] = url
    else if (source.startsWith('components/'))
      manifest.modules[source.slice('components/'.length)] = url
  }
  return manifest
}

/** Where a Vite build's files are: the manifest's own folder, less Vite's `.vite/`. */
export function viteOutDir(siteDir: string, manifestPath: string): string {
  const folder = dirname(resolve(siteDir, manifestPath))
  return folder.endsWith(`${sep}.vite`) ? dirname(folder) : folder
}

/** A Vite dev server's modules, for development, by source path. */
export function devServerIslandManifest(devServer: string, componentsDir: string): IslandManifest {
  const base = devServer.replace(/\/+$/, '')
  const manifest: IslandManifest = { react: `${base}/@id/${BROWSER_ENTRY}`, modules: {} }
  const walk = (current: string) => {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.[jt]sx?$/.test(entry.name)) {
        const key = toKey(relative(componentsDir, path))
        const url = `${base}/components/${key}`
        manifest.modules[key] = url
        if (key.startsWith('client/')) manifest.modules[key.replace(/\.[jt]sx?$/, '')] = url
      }
    }
  }
  walk(componentsDir)
  return manifest
}
