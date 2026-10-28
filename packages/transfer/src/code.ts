/**
 * A site's own code, carried in its bundle (stories 192, 193): the files its
 * `package.json` names in `crombolo.code`, at their site paths under `code/`,
 * listed in `bundle.json` and covered by its one hash like every other section.
 * `docs/bundles.md`, "A site's bundle with code".
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, sep } from 'node:path'
import { loadBundle } from './load.ts'
import { BUNDLE_SECTIONS } from './model.ts'
import type { BundleFile } from './write.ts'

/** The section, and directory, that holds the site's code. */
export const CODE_DIR = BUNDLE_SECTIONS.code

/** Packed whenever there is code: what installing and booting it needs. */
export const CODE_ALWAYS = ['package.json', 'bun.lock', 'crombolo.config.ts'] as const

/** The folders a bundle already carries as sections, or that are a site's local state. */
const SITE_FOLDERS = new Set([
  'schema',
  'components',
  'css',
  'scripts',
  'seed',
  'media',
  'logs',
  '.crombolo',
])

/** Never packed, whatever a pattern matches: installs, history, secrets and databases. */
export function isNeverCode(path: string): boolean {
  const parts = path.split('/')
  const name = parts.at(-1) as string
  return (
    SITE_FOLDERS.has(parts[0] as string) ||
    parts.some((part) => part === 'node_modules' || part === '.git') ||
    name === '.env' ||
    name.startsWith('.env.') ||
    /\.sqlite(?:$|-|\.)/.test(name)
  )
}

/** `crombolo.code` in a site's `package.json`, or undefined when it names none. */
export function codePatternsOf(siteDir: string): string[] | undefined {
  const file = join(siteDir, 'package.json')
  if (!existsSync(file)) return undefined
  const json = JSON.parse(readFileSync(file, 'utf8')) as { crombolo?: { code?: unknown } }
  const code = json.crombolo?.code
  return Array.isArray(code) ? code.filter((p): p is string => typeof p === 'string') : undefined
}

/**
 * The site's files the patterns name, plus `CODE_ALWAYS`, in path order. A
 * pattern that matches nothing is a problem rather than a silent gap, and so is
 * a site without the lockfile its code would be installed from.
 */
export function selectCodeFiles(
  siteDir: string,
  patterns: readonly string[],
): { paths: string[]; problems: string[] } {
  const problems: string[] = []
  const paths = new Set<string>()
  for (const pattern of patterns) {
    if (isAbsolute(pattern) || pattern.split('/').includes('..')) {
      problems.push(`"${pattern}" reaches outside the site`)
      continue
    }
    let matched = 0
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: siteDir, dot: true })) {
      const normal = path.split(sep).join('/')
      if (isNeverCode(normal)) continue
      paths.add(normal)
      matched++
    }
    if (matched === 0) problems.push(`"${pattern}" matches no file the bundle can carry`)
  }
  for (const always of CODE_ALWAYS) if (existsSync(join(siteDir, always))) paths.add(always)
  if (!existsSync(join(siteDir, 'package.json'))) problems.push('the site has no package.json')
  if (!existsSync(join(siteDir, 'bun.lock')))
    problems.push('the site has no bun.lock, so its code could not be installed as it was tested')
  return { paths: [...paths].sort(), problems }
}

/** The files at those paths, as bytes and as the bundle carries them, under `code/`. */
export function readCodeFiles(siteDir: string, paths: readonly string[]): BundleFile[] {
  return paths.map((path) => ({
    path: `${CODE_DIR}/${path}`,
    bytes: new Uint8Array(readFileSync(join(siteDir, path))),
  }))
}

export interface LoadedBundleCode {
  /** The absolute directory holding the code, when the bundle carries some. */
  dir?: string
  /** Every file under it, relative to it and `/`-separated. */
  paths: string[]
  /** The bundle's own problems, its hash among them, with any about the code. */
  problems: string[]
}

/** A bundle package's code, read through the bundle's own loader and its one hash. */
export function loadBundleCode(packageDir: string): LoadedBundleCode {
  const loaded = loadBundle(packageDir)
  const problems = loaded.problems.map((p) => `${p.file}: ${p.message}`)
  const carried = loaded.set?.manifest.carries?.code
  if (!loaded.set) return { paths: [], problems }
  if (!carried) return { paths: [], problems: [...problems, 'the bundle carries no code'] }
  const prefix = `${CODE_DIR}/`
  return {
    dir: join(packageDir, CODE_DIR),
    paths: carried.map((path) => path.slice(prefix.length)),
    problems,
  }
}
