/**
 * Reading a site's content files (story 163) into items: pages from
 * `content/pages/`, Library elements from `content/library/`, and media files
 * and their folders from `content/media/` (story 167; once `seed/`). A page is a
 * TOML file named for its URL segment, with its children in a folder of the same
 * name; a media file may have a sidecar, `photo.jpg.toml`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export type SeedKind = 'content' | 'library' | 'media'

/** The folder a site's content files are in. */
export const CONTENT_FILES_DIR = 'content'

/** Each kind's folder under it. A page's kind is `content`, as the keys derived from it say. */
export const KIND_DIRS: Readonly<Record<SeedKind, string>> = {
  content: 'pages',
  library: 'library',
  media: 'media',
}

/** A kind's folder, relative to the site: `content/pages`. */
export const kindDir = (kind: SeedKind) => `${CONTENT_FILES_DIR}/${KIND_DIRS[kind]}`

/** What to run when a site still has its content files where they were before story 167. */
export const MOVE_FROM_SEED = 'git mv seed content && git mv content/content content/pages'

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
  /** A media folder: a directory under `content/media/`. */
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
  const root = join(siteDir, CONTENT_FILES_DIR)
  const items: SeedItem[] = []
  const findings: SeedFinding[] = []
  const shown = (path: string) => relative(siteDir, path)
  // Content files where they were before story 167 are not read, and say where to go.
  if (existsSync(join(siteDir, 'seed')) && !existsSync(root))
    return {
      items,
      findings: [
        {
          file: 'seed',
          line: 1,
          code: 'moved',
          message: `content files now live in content/pages, content/library and content/media: ${MOVE_FROM_SEED}`,
        },
      ],
    }

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
            message: 'Library elements sit at the top of content/library: folders are not read yet',
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

  content('content', join(root, KIND_DIRS.content), null)
  content('library', join(root, KIND_DIRS.library), null)
  media(join(root, KIND_DIRS.media), null)
  return { items, findings }
}

/** Whether a site has content files at all, where they are or where they were. */
export const hasSeed = (siteDir: string) =>
  existsSync(join(siteDir, CONTENT_FILES_DIR)) || existsSync(join(siteDir, 'seed'))
