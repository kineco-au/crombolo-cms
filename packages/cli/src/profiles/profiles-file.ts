/**
 * `~/.crombolo/profiles` (story 352): the sites a person's commands reach by
 * name, hosted or in a folder on this machine. It is their own file, so a
 * change rewrites only the profile it is about, leaving the rest as written.
 *
 *   [default]
 *   url = "https://riverside.example"
 *   environment = "production"
 *
 *   [riverside-copy]
 *   path = "~/dev/riverside-copy"
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { writeFileAtomic } from '@crombolo/server/atomic-write'
import { setting } from '@crombolo/server/settings'
import { CliError } from '../errors.ts'

export interface HostedProfile {
  name: string
  url: string
  /** The environment a command goes to when `--env` is not given. */
  environment?: string
}

export interface FolderProfile {
  name: string
  /** As written: absolute, or from `~`. */
  path: string
}

export type Profile = HostedProfile | FolderProfile

export const isFolder = (profile: Profile): profile is FolderProfile => 'path' in profile

export const PROFILE_NAME = /^[a-z][a-z0-9-]{0,39}$/

const KEYS = ['url', 'environment', 'path']

export const profilesFile = (): string =>
  setting('CROMBOLO_PROFILES_FILE') ?? join(homedir(), '.crombolo', 'profiles')

/** A profile's folder, with `~` as the home folder. */
export const expandHome = (path: string): string =>
  path === '~' || path.startsWith('~/') || path.startsWith('~\\')
    ? join(homedir(), path.slice(1))
    : path

/** The first line from which the file no longer reads: Bun's error does not say where. */
function syntaxLine(text: string): number {
  const lines = text.split('\n')
  for (let n = 1; n <= lines.length; n++) {
    try {
      Bun.TOML.parse(lines.slice(0, n).join('\n'))
    } catch {
      return n
    }
  }
  return lines.length
}

const headerOf = (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*\\[\\s*(?:${escaped}|"${escaped}"|'${escaped}')\\s*\\](?:\\s*#.*)?\\s*$`)
}

const lineOf = (text: string, name: string) => {
  const at = text.split('\n').findIndex((line) => headerOf(name).test(line))
  return at < 0 ? undefined : at + 1
}

function malformed(file: string, message: string, line?: number): CliError {
  return new CliError('usage', `${file}${line ? `, line ${line}` : ''}: ${message}`, {
    hint: 'Correct it there, or with `crombolo profile add` and `profile remove`.',
  })
}

/** Every profile in the file, refusing one written wrongly rather than skipping it. */
export function readProfiles(file: string = profilesFile()): Profile[] {
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  let parsed: Record<string, unknown>
  try {
    parsed = Bun.TOML.parse(text) as Record<string, unknown>
  } catch {
    throw malformed(file, 'this is not TOML that can be read.', syntaxLine(text))
  }
  const profiles: Profile[] = []
  for (const [name, table] of Object.entries(parsed)) {
    const line = lineOf(text, name)
    const bad = (message: string) => malformed(file, `profile "${name}" ${message}`, line)
    if (!PROFILE_NAME.test(name))
      throw bad('is not a name: lower case letters, digits and dashes, starting with a letter.')
    if (typeof table !== 'object' || table === null || Array.isArray(table))
      throw bad('is not a table of url, environment or path.')
    const entry = table as Record<string, unknown>
    const unknown = Object.keys(entry).filter((key) => !KEYS.includes(key))
    if (unknown.length > 0)
      throw bad(`has ${unknown.join(', ')}, which is not one of url, environment and path.`)
    for (const key of KEYS)
      if (key in entry && typeof entry[key] !== 'string')
        throw bad(`has a ${key} that is not text.`)
    const { url, environment, path } = entry as Record<string, string | undefined>
    if ((url === undefined) === (path === undefined))
      throw bad('needs exactly one of url, for a hosted site, and path, for a site folder.')
    if (path !== undefined) {
      if (environment !== undefined) throw bad('has an environment, which only a url takes.')
      if (!isAbsolute(expandHome(path)))
        throw bad(`has the path "${path}", which is relative: start it at / or ~.`)
      profiles.push({ name, path })
      continue
    }
    try {
      new URL(url as string)
    } catch {
      throw bad(`has the url "${url}", which is not an address.`)
    }
    profiles.push({ name, url: url as string, ...(environment ? { environment } : {}) })
  }
  return profiles
}

const quote = (value: string) => JSON.stringify(value)

function tableOf(profile: Profile): string[] {
  if (isFolder(profile)) return [`[${profile.name}]`, `path = ${quote(profile.path)}`]
  return [
    `[${profile.name}]`,
    `url = ${quote(profile.url)}`,
    ...(profile.environment ? [`environment = ${quote(profile.environment)}`] : []),
  ]
}

/**
 * Where a profile's table is: its header to its last key, so the comments and
 * blank lines after it stay with whatever follows.
 */
function spanOf(lines: readonly string[], name: string): { from: number; to: number } | undefined {
  const from = lines.findIndex((line) => headerOf(name).test(line))
  if (from < 0) return undefined
  let to = from
  for (let at = from + 1; at < lines.length; at++) {
    const line = (lines[at] as string).trim()
    if (line.startsWith('[')) break
    if (line !== '' && !line.startsWith('#')) to = at
  }
  return { from, to }
}

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileAtomic(file, text)
}

const FIRST_LINES = [
  '# The sites crombolo commands reach by name, with --profile. Addresses and',
  '# folders only: sign-ins are kept in your keychain, never here.',
]

/** Adds a profile, or replaces the one of its name, changing nothing else in the file. */
export function addProfile(profile: Profile, file: string = profilesFile()): void {
  if (!PROFILE_NAME.test(profile.name))
    throw new CliError(
      'usage',
      `"${profile.name}" is not a profile name: lower case letters, digits and dashes, starting with a letter.`,
    )
  const exists = readProfiles(file).some((p) => p.name === profile.name)
  if (!existsSync(file)) {
    write(file, `${[...FIRST_LINES, '', ...tableOf(profile)].join('\n')}\n`)
    return
  }
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  if (!exists) {
    const body = text.replace(/\s*$/, '')
    write(file, `${body}${body ? '\n\n' : ''}${tableOf(profile).join('\n')}\n`)
    return
  }
  const span = spanOf(lines, profile.name)
  if (!span) throw notATable(file, profile.name)
  lines.splice(span.from, span.to - span.from + 1, ...tableOf(profile))
  write(file, lines.join('\n'))
}

/** Removes a profile, and only it; false when there was none of that name. */
export function removeProfile(name: string, file: string = profilesFile()): boolean {
  if (!readProfiles(file).some((p) => p.name === name)) return false
  const lines = readFileSync(file, 'utf8').split('\n')
  const span = spanOf(lines, name)
  if (!span) throw notATable(file, name)
  // The comment just above it is about it, and goes with it.
  let from = span.from
  while (from > 0 && lines[from - 1]?.trim().startsWith('#')) from--
  // One blank line between what was either side of it, as there was before.
  const blankAfter =
    lines[span.to + 1]?.trim() === '' && (from === 0 || lines[from - 1]?.trim() === '')
  lines.splice(from, span.to - from + 1 + (blankAfter ? 1 : 0))
  write(file, lines.join('\n'))
  return true
}

const notATable = (file: string, name: string) =>
  new CliError('usage', `${file} writes "${name}" in a way only an editor can change.`, {
    hint: `Change it there, as a [${name}] table.`,
  })

/** The profile of a name, refusing one there is not, naming those there are. */
export function profileNamed(name: string, file: string = profilesFile()): Profile {
  const profiles = readProfiles(file)
  const found = profiles.find((p) => p.name === name)
  if (found) return found
  throw new CliError('not_found', `There is no profile "${name}".`, {
    hint:
      profiles.length > 0
        ? `The profiles are: ${profiles.map((p) => p.name).join(', ')}.`
        : '`crombolo profile add <name> <url>` adds one.',
  })
}
