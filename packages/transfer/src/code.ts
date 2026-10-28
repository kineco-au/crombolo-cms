/**
 * A site's own code, carried in its bundle (story 192): the files its
 * `package.json` names in `crombolo.code`, at their site paths under `code/`
 * beside the payload, with a hash of their own in the bundle's `package.json`.
 * `docs/bundles.md`, "A site's bundle with code".
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import { type BundleFile, filesIntegrity } from './write.ts'

/** The directory beside `content/` that holds the site's code. */
export const CODE_DIR = 'code'

/** Packed whenever there is code: what installing and booting it needs. */
export const CODE_ALWAYS = ['package.json', 'bun.lock', 'crombolo.config.ts'] as const

/** `crombolo.code` in a bundle's `package.json`: where its code is, and the hash over it. */
export interface BundleCodeField {
  dir: string
  integrity: string
}

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

/** The files at those paths, as bytes: a site's source is not only text. */
export function readCodeFiles(siteDir: string, paths: readonly string[]): BundleFile[] {
  return paths.map((path) => ({ path, bytes: new Uint8Array(readFileSync(join(siteDir, path))) }))
}

/** The hash `crombolo.code.integrity` holds, over the code's paths and bytes. */
export const codeIntegrity = (files: readonly BundleFile[]): string => filesIntegrity(files)

export interface LoadedBundleCode {
  /** The absolute directory holding the code, when the bundle carries some. */
  dir?: string
  /** Every file under it, relative and `/`-separated. */
  paths: string[]
  problems: string[]
}

/** A bundle package's code, read and checked against its hash. */
export function loadBundleCode(packageDir: string): LoadedBundleCode {
  const manifest = join(packageDir, 'package.json')
  if (!existsSync(manifest)) return { paths: [], problems: [`no package at ${packageDir}`] }
  const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
    crombolo?: { code?: Partial<BundleCodeField> }
  }
  const field = json.crombolo?.code
  if (!field) return { paths: [], problems: ['the bundle carries no code'] }
  if (typeof field.dir !== 'string' || typeof field.integrity !== 'string')
    return { paths: [], problems: ['"crombolo.code" names no directory and hash'] }
  const dir = normalize(join(packageDir, field.dir))
  if (!dir.startsWith(normalize(packageDir) + sep))
    return { paths: [], problems: [`"crombolo.code" (${field.dir}) is outside the package`] }
  if (!existsSync(dir))
    return {
      paths: [],
      problems: [`the bundle says it carries code in ${field.dir}, and it is not there`],
    }
  const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
  const integrity = codeIntegrity(readCodeFiles(dir, paths))
  return {
    dir,
    paths,
    problems:
      integrity === field.integrity
        ? []
        : [
            `the code does not match its hash (${field.integrity} vs ${integrity}) — it is incomplete or was edited`,
          ],
  }
}
