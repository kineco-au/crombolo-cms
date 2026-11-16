/**
 * A site's guide for coding agents (story 370): `AGENTS.md`, holding the CMS's
 * own block and one block per remote whose discovery names a guide. Only the
 * blocks are ever written; every other line is the developer's and stays as
 * it is. A remote's guide is data: fetched as text, its markers escaped so it
 * can't close its block or pass as the CMS's, and never run.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VERSION } from '@crombolo/server'
import { writeFileAtomic } from '@crombolo/server/atomic-write'

export const AGENTS_FILE = 'AGENTS.md'
/** The profiles a site came from, by name: each person's own, so kept out of git. */
export const SITE_PROFILES_FILE = join('.crombolo', 'profiles.json')
/** The most of a remote's guide that is read. */
export const GUIDE_LIMIT = 64 * 1024

const CMS = 'crombolo'
const remoteMarker = (origin: string) => `remote:${origin}`

const open = (marker: string) => `<!-- ${marker} -->`
const close = (marker: string) => `<!-- /${marker} -->`

/** The CMS's own guide, versioned with the CLI. */
export function cmsGuide(version = VERSION): string {
  return `## Working on this crombolo site

This is a [crombolo](https://github.com/kineco-au/crombolo-cms) site, made with crombolo ${version}.

- **The folders:**
  - \`schema/\` holds the content types, data types and workflows, as TOML files;
  - \`components/\` holds the views, as TSX, one per template or block;
  - \`public/\` holds files served as they are;
  - \`crombolo.config.ts\` holds the site's settings.
- **Schema is files.** Change a type by editing its file in \`schema/\`, then \`crombolo types check\`
  and \`crombolo types sync\`. \`crombolo schema\` describes every command for a machine.
- **Types:** \`crombolo generate\` writes the TypeScript types the components use, after a schema change.
- **Before a push:** \`crombolo components check\` and \`crombolo site build\` must pass.
- **Documentation:** https://github.com/kineco-au/crombolo-cms/tree/v${version}/docs, and
  \`crombolo <command> --help\`.`
}

/** A guide's text with every block marker escaped, so it stays inside its own block. */
export function escapeMarkers(text: string): string {
  return text.replace(/<!--(\s*\/?\s*(?:crombolo|remote:))/gi, '&lt;!--$1')
}

const blockPattern = (marker: string) =>
  new RegExp(`${escapeRegExp(open(marker))}[\\s\\S]*?${escapeRegExp(close(marker))}\\n?`, 'g')

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `text` with the block added at the end, or put in place of the one there. */
export function withBlock(text: string, marker: string, body: string): string {
  const block = `${open(marker)}\n${body.trim()}\n${close(marker)}\n`
  const pattern = blockPattern(marker)
  if (pattern.test(text)) return text.replace(blockPattern(marker), block)
  if (text === '') return block
  return `${text}${text.endsWith('\n') ? '' : '\n'}\n${block}`
}

/** `text` without the block, and without the blank line left before it. */
export function withoutBlock(text: string, marker: string): string {
  return text.replace(new RegExp(`\\n?${blockPattern(marker).source}`, 'g'), '')
}

/** The origins of the remote blocks in `text`. */
export function remoteOrigins(text: string): string[] {
  return [...text.matchAll(/<!-- remote:(\S+) -->/g)].map((m) => m[1] as string)
}

export const withCmsBlock = (text: string, version?: string) =>
  withBlock(text, CMS, cmsGuide(version))

/** A remote's block: where it came from, then its guide as text. */
export function withRemoteBlock(text: string, origin: string, guide: string): string {
  return withBlock(
    text,
    remoteMarker(origin),
    `## From ${origin}\n\nThis part is ${origin}'s guide for agents, fetched by \`crombolo agents refresh\`.\n\n${escapeMarkers(guide.trim())}`,
  )
}

export const withoutRemoteBlock = (text: string, origin: string) =>
  withoutBlock(text, remoteMarker(origin))

export function readAgentsFile(siteDir: string): string {
  const file = join(siteDir, AGENTS_FILE)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

export function writeAgentsFile(siteDir: string, text: string): void {
  writeFileAtomic(join(siteDir, AGENTS_FILE), text)
}

/** A profile the site came from (D1), with the origin it had, so its block is found once it is gone. */
export interface SiteProfile {
  name: string
  origin: string
}

export function readSiteProfiles(siteDir: string): SiteProfile[] {
  const file = join(siteDir, SITE_PROFILES_FILE)
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { profiles?: unknown }
    return Array.isArray(parsed.profiles)
      ? parsed.profiles.filter(
          (p): p is SiteProfile => typeof p?.name === 'string' && typeof p?.origin === 'string',
        )
      : []
  } catch {
    return []
  }
}

/** Writes the record, one entry per profile name, the later of two winning. */
export function writeSiteProfiles(siteDir: string, profiles: readonly SiteProfile[]): void {
  const byName = new Map(profiles.map((p) => [p.name, { name: p.name, origin: p.origin }]))
  const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  writeFileAtomic(
    join(siteDir, SITE_PROFILES_FILE),
    `${JSON.stringify({ profiles: list }, null, 2)}\n`,
  )
}

/**
 * A remote's guide, as text: https (or this machine), no redirect followed, at
 * most 64 KB. A reason instead when it can't be had.
 */
export async function fetchGuide(
  url: string,
  http: typeof fetch = fetch,
): Promise<{ text: string } | { problem: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { problem: `its address, ${url}, is not one` }
  }
  if (
    parsed.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  )
    return { problem: `${parsed.origin} is not HTTPS` }
  let response: Response
  try {
    response = await http(parsed, {
      redirect: 'manual',
      headers: { accept: 'text/markdown, text/plain' },
    })
  } catch (error) {
    return { problem: `it could not be reached: ${error instanceof Error ? error.message : error}` }
  }
  if (response.status >= 300 && response.status < 400)
    return { problem: 'it redirects, and a guide is read only from where discovery says' }
  if (!response.ok) return { problem: `it answered ${response.status}` }
  const type = response.headers.get('content-type') ?? ''
  if (type && !/^text\//i.test(type)) return { problem: `it is ${type}, not text` }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > GUIDE_LIMIT) return { problem: 'it is larger than 64 KB' }
  // Read no further than the limit, whatever the length it claims.
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > GUIDE_LIMIT) {
      await reader.cancel()
      return { problem: 'it is larger than 64 KB' }
    }
    chunks.push(value)
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)) }
}
