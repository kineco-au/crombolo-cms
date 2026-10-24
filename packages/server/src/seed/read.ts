/**
 * Reading a site's `seed/` directory (story 163) into items: the content tree
 * from `seed/content/`, Library elements from `seed/library/`, and media files
 * and their folders from `seed/media/`. A content item is a TOML file named for
 * its URL segment, with its children in a folder of the same name; a media file
 * may have a sidecar, `photo.jpg.toml`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export type SeedKind = 'content' | 'library' | 'media'

export interface SeedItem {
  kind: SeedKind
  /** Its path in the tree, by segment: `about/team`, `logos/mark.png`. */
  path: string
  /** The parent's path, or null at the top. */
  parent: string | null
  /** The TOML file that describes it, relative to the site; null for a media item with no sidecar. */
  file: string | null
  text: string
  data: Record<string, unknown>
  /** A media file's bytes. */
  bytes?: Uint8Array
  /** A media folder: a directory under `seed/media/`. */
  folder?: boolean
}

export interface SeedFinding {
  file: string
  line: number
  code: string
  message: string
}

export interface SeedTree {
  items: SeedItem[]
  findings: SeedFinding[]
}

const SKIPPED = (name: string) => name.startsWith('.')

/**
 * The line a TOML syntax error is on: the first prefix of the file that does
 * not parse. The parser's own position is not always the file's.
 */
function syntaxLine(text: string): number {
  const lines = text.split('\n')
  for (let n = 1; n <= lines.length; n++) {
    try {
      Bun.TOML.parse(lines.slice(0, n).join('\n'))
    } catch {
      return n
    }
  }
  return 1
}

export function readSeed(siteDir: string): SeedTree {
  const root = join(siteDir, 'seed')
  const items: SeedItem[] = []
  const findings: SeedFinding[] = []
  const shown = (path: string) => relative(siteDir, path)

  const parse = (path: string): { text: string; data: Record<string, unknown> } | undefined => {
    const text = readFileSync(path, 'utf8')
    try {
      return { text, data: Bun.TOML.parse(text) as Record<string, unknown> }
    } catch (error) {
      const line = syntaxLine(text)
      findings.push({
        file: shown(path),
        line,
        code: 'syntax',
        message: (error as Error).message,
      })
      return undefined
    }
  }

  const content = (kind: 'content' | 'library', dir: string, parent: string | null) => {
    if (!existsSync(dir)) return
    const names = readdirSync(dir)
      .filter((name) => !SKIPPED(name))
      .sort()
    for (const name of names) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (kind === 'library') {
          findings.push({
            file: shown(path),
            line: 1,
            code: 'library-folder',
            message: 'Library elements sit at the top of seed/library: folders are not read yet',
          })
          continue
        }
        if (!names.includes(`${name}.toml`))
          findings.push({
            file: shown(path),
            line: 1,
            code: 'orphan-folder',
            message: `the folder ${name}/ holds children, but there is no ${name}.toml for the page they sit under`,
          })
        continue
      }
      if (!name.endsWith('.toml')) {
        findings.push({
          file: shown(path),
          line: 1,
          code: 'not-toml',
          message: 'only .toml files describe content; this one is not read',
        })
        continue
      }
      const segment = name.slice(0, -'.toml'.length)
      const itemPath = parent ? `${parent}/${segment}` : segment
      const parsed = parse(path)
      if (parsed) items.push({ kind, path: itemPath, parent, file: shown(path), ...parsed })
      if (kind === 'content') content(kind, join(dir, segment), itemPath)
    }
  }

  const media = (dir: string, parent: string | null) => {
    if (!existsSync(dir)) return
    const names = readdirSync(dir)
      .filter((name) => !SKIPPED(name))
      .sort()
    for (const name of names) {
      const path = join(dir, name)
      const itemPath = parent ? `${parent}/${name}` : name
      if (statSync(path).isDirectory()) {
        items.push({
          kind: 'media',
          path: itemPath,
          parent,
          file: null,
          text: '',
          data: {},
          folder: true,
        })
        media(path, itemPath)
        continue
      }
      if (name.endsWith('.toml')) {
        if (!names.includes(name.slice(0, -'.toml'.length)))
          findings.push({
            file: shown(path),
            line: 1,
            code: 'orphan-sidecar',
            message: `there is no ${name.slice(0, -'.toml'.length)} beside this sidecar`,
          })
        continue
      }
      const sidecar = names.includes(`${name}.toml`) ? parse(join(dir, `${name}.toml`)) : undefined
      items.push({
        kind: 'media',
        path: itemPath,
        parent,
        file: sidecar ? shown(join(dir, `${name}.toml`)) : null,
        text: sidecar?.text ?? '',
        data: sidecar?.data ?? {},
        bytes: new Uint8Array(readFileSync(path)),
      })
    }
  }

  content('content', join(root, 'content'), null)
  content('library', join(root, 'library'), null)
  media(join(root, 'media'), null)
  return { items, findings }
}

/** Whether a site has a seed at all. */
export const hasSeed = (siteDir: string) => existsSync(join(siteDir, 'seed'))
