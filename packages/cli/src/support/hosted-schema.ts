/**
 * A hosted site's schema files from the command line (story 374): read through
 * the remote protocol, compared with this checkout's `schema/`, and changed by
 * the definition alongside the files, which are written first and so are never
 * older than the site.
 */
import { writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { parseSchemaSettings, writeSchemaVersion } from '@crombolo/schema'
import {
  type CromboloConfig,
  type SchemaEdit,
  type SchemaEditResult,
  type SchemaWrites,
  schemaFileHash,
  schemaFilesIn,
  schemaPathOf,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { classify } from '../classify.ts'
import { CliError } from '../errors.ts'
import { siteOf } from '../profiles/choose.ts'
import { profileNamed } from '../profiles/profiles-file.ts'
import { RemoteError } from '../remote/client.ts'
import { here } from './describe.ts'
import { confirm } from './prompt.ts'
import { connectSite, needEnvironment } from './remote.ts'
import type { Io } from './site.ts'

export interface HostedSchema {
  /** The profile that names it. */
  profile: string
  files(): Promise<{ version: string; files: Record<string, string> }>
  edit(edit: SchemaEdit): Promise<SchemaEditResult>
}

const CAPABILITY_WORDS = {
  'schema-files': 'read its schema',
  'schema-edit': 'change its schema',
} as const

/** The hosted site a profile names, refusing a site folder, with what the flag is for. */
export async function hostedSchema(
  profile: string,
  env: string | undefined,
  flag: string,
  capability: keyof typeof CAPABILITY_WORDS,
): Promise<HostedSchema> {
  const choice = siteOf(profileNamed(profile), env)
  if (choice.kind !== 'hosted')
    throw new CliError('usage', `${profile} is a site folder, and ${flag} names a hosted site.`, {
      hint: 'In a site folder, its own `crombolo types` commands change it.',
    })
  const { discovery, client, environment } = await connectSite(choice)
  if (!discovery.capabilities?.includes(capability))
    throw new CliError(
      'refused',
      `${profile} can't ${CAPABILITY_WORDS[capability]} from the command line.`,
      {
        hint: `${discovery.name} needs a newer crombolo, or a CROMBOLO_REMOTE_ACCESS of ${capability === 'schema-edit' ? 'content' : 'read'} or more.`,
      },
    )
  const at = `environments/${needEnvironment(environment, discovery)}`
  return {
    profile,
    files: () => client.json(`${at}/schema`),
    edit: (edit) => client.post(`${at}/schema/edits`, edit),
  }
}

export interface SchemaDifference {
  path: string
  change: 'only-here' | 'only-there' | 'differs'
}

/** `schema.toml` as far as it is a definition: its settings, never its version. */
const settingsOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined
  const parsed = parseSchemaSettings('schema.toml', text).value
  return parsed ? writeSchemaVersion('0', parsed.urls, parsed.environments) : text
}

/** The version a schema's `schema.toml` names; `1.0.0` without one. */
export function versionIn(files: ReadonlyMap<string, string>): string {
  const text = files.get('schema.toml')
  return (text && parseSchemaSettings('schema.toml', text).value?.version) || '1.0.0'
}

/** Each file here and there that is not the same, by path. Pure. */
export function schemaDiff(
  here: ReadonlyMap<string, string>,
  there: ReadonlyMap<string, string>,
): SchemaDifference[] {
  const differences: SchemaDifference[] = []
  for (const path of new Set([...here.keys(), ...there.keys()])) {
    const mine = here.get(path)
    const theirs = there.get(path)
    if (path === 'schema.toml' ? settingsOf(mine) === settingsOf(theirs) : mine === theirs) continue
    differences.push({
      path,
      change: theirs === undefined ? 'only-here' : mine === undefined ? 'only-there' : 'differs',
    })
  }
  return differences.sort((a, b) => a.path.localeCompare(b.path))
}

/** Whether `a` is a later version than `b`, part by part. Pure. */
export function laterVersion(a: string, b: string): boolean {
  const parts = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export interface ToFlags {
  to?: string
  env?: string
  force?: boolean
  all?: boolean
  yes?: boolean
}

/** The flags a type-editing command takes to change a hosted site too. */
export const toFlags = {
  to: Flags.string({
    summary: 'change this hosted site too, by its profile, after the files',
    helpValue: '<profile>',
  }),
  env: Flags.string({ summary: "the --to site's environment", helpValue: '<id>' }),
  force: Flags.boolean({
    summary: "with --to: change it there though the site's copy differs from these files",
  }),
  all: Flags.boolean({
    summary: "with --to: make the site's definitions match these files, not only this change",
  }),
  yes: Flags.boolean({ summary: 'with --to --all: overwrite them there without asking' }),
}

/** What a hosted site did with a change, as a command answers it. */
export interface HostedOutcome {
  site: string
  applied: boolean
  version: string | null
  findings: string[]
}

/**
 * The files a change writes or removes, as `schema/` paths a hosted site takes.
 * Files the layout does not hold, such as generated declarations, are not sent;
 * a change to views or content files is refused, since those reach the site
 * only with a deploy.
 */
export function schemaWritesOf(
  config: CromboloConfig,
  edits: ReadonlyArray<{ file: string; next: string | null }>,
  site: string,
): SchemaWrites {
  const writes: SchemaWrites = {}
  const outside: string[] = []
  for (const { file, next } of edits) {
    const within = relative(config.schemaDir, file)
    if (within.startsWith('..') || isAbsolute(within)) {
      outside.push(here(file))
      continue
    }
    const path = within.split(sep).join('/')
    if (schemaPathOf(path) === path) writes[path] = next
  }
  if (outside.length > 0)
    throw new CliError(
      'refused',
      `Nothing was changed: this changes files besides the definitions, which reach ${site} only with a deploy.`,
      {
        hint: 'Make the change without --to and deploy it, or make it there and bring it here with `crombolo types export --from`.',
        details: outside,
      },
    )
  return writes
}

/**
 * A change on its way to a hosted site: checked there before any file here is
 * written, and applied there once they are. Nothing is sent without --to.
 */
export class HostedChange {
  private constructor(
    private readonly hosted: HostedSchema,
    private readonly sending: SchemaEdit,
    readonly findings: string[],
  ) {}

  /** Checks the change on the site, refusing when its copy differs, unless --force or --all. */
  static async prepare(
    io: Io,
    config: CromboloConfig,
    writes: SchemaWrites,
    flags: ToFlags,
    options: { retire?: boolean } = {},
  ): Promise<HostedChange | undefined> {
    if (!flags.to) {
      const stray = (['env', 'force', 'all', 'yes'] as const).filter(
        (f) => flags[f] !== undefined && flags[f] !== false,
      )
      if (stray.length > 0)
        throw new CliError('usage', `${stray.map((f) => `--${f}`).join(', ')} go with --to.`)
      return undefined
    }
    const site = flags.to
    const hosted = await hostedSchema(site, flags.env, '--to', 'schema-edit')
    const there = new Map(Object.entries((await hosted.files()).files))
    const mine = schemaFilesIn(config.schemaDir)
    let edits: SchemaWrites
    if (flags.all) {
      const after = new Map(mine)
      for (const [path, text] of Object.entries(writes))
        if (text === null) after.delete(path)
        else after.set(path, text)
      const differences = schemaDiff(after, there)
      edits = Object.fromEntries(
        differences.map(({ path, change }) => [
          path,
          change === 'only-there' ? null : (after.get(path) as string),
        ]),
      )
      const lost = differences.filter((d) => d.change !== 'only-here')
      if (lost.length > 0) {
        io.say(`  on ${site}, --all overwrites:`)
        for (const { path, change } of lost)
          io.say(`    ${change === 'only-there' ? 'remove ' : 'replace'}  ${path}`)
        if (!flags.yes)
          await confirm(`Overwrite these on ${site}? [y/N]`, {
            bypass: '--yes',
            declined: 'Nothing was changed.',
          })
      }
    } else {
      edits = writes
      const moved = Object.keys(writes).filter((path) => mine.get(path) !== there.get(path))
      if (moved.length > 0 && !flags.force)
        throw new CliError(
          'conflict',
          `Nothing was changed: ${site}'s copy differs from these files, so this would overwrite a change made there.`,
          {
            hint: `\`crombolo types check --against ${site}\` shows how; \`crombolo types export --from ${site}\` brings its definitions here. --force changes it there anyway.`,
            details: moved,
          },
        )
    }
    const base = Object.fromEntries(
      Object.keys(edits).map((path) => [path, schemaFileHash(there.get(path))]),
    )
    const sending: SchemaEdit = { edits, base, retire: options.retire === true }
    if (Object.keys(edits).length === 0) {
      io.say(`  on ${site}  already so`)
      return new HostedChange(hosted, sending, [])
    }
    let checked: SchemaEditResult
    try {
      checked = await hosted.edit({ ...sending, dryRun: true })
    } catch (error) {
      throw refusal(error, `Nothing was changed: ${site} would not take it`)
    }
    for (const finding of checked.findings) io.say(`  on ${site}  ${finding}`)
    return new HostedChange(hosted, sending, checked.findings)
  }

  /** What would be sent, for a dry run. */
  planned(): HostedOutcome {
    return { site: this.hosted.profile, applied: false, version: null, findings: this.findings }
  }

  /**
   * Applies the change on the site, once the files are written. A refusal leaves
   * them changed and says so; an applied change brings the site's version here.
   */
  async apply(io: Io, config: CromboloConfig): Promise<HostedOutcome & { raised: boolean }> {
    const site = this.hosted.profile
    if (Object.keys(this.sending.edits).length === 0)
      return { ...this.planned(), raised: await bringVersion(io, config, undefined) }
    let result: SchemaEditResult
    try {
      result = await this.hosted.edit(this.sending)
    } catch (error) {
      throw refusal(error, `The files are changed, but ${site} refused the change`, {
        hint: `\`crombolo types export --from ${site}\` brings ${site}'s definitions back into the files.`,
      })
    }
    io.say(`  on ${site}  ${result.changed ? `applied: schema ${result.version}` : 'already so'}`)
    return {
      site,
      applied: result.changed,
      version: result.version,
      findings: result.findings,
      raised: await bringVersion(io, config, result.version),
    }
  }
}

/** The site's version written to `schema.toml` when it is later than the files'. */
async function bringVersion(
  io: Io,
  config: CromboloConfig,
  version: string | undefined,
): Promise<boolean> {
  if (!version) return false
  const file = join(config.schemaDir, 'schema.toml')
  const mine = schemaFilesIn(config.schemaDir)
  const current = versionIn(mine)
  if (!laterVersion(version, current)) return false
  const text = mine.get('schema.toml')
  const settings = text ? parseSchemaSettings('schema.toml', text).value : undefined
  writeFileSync(file, writeSchemaVersion(version, settings?.urls, settings?.environments))
  io.say(`  version  ${current} → ${version}: the site's, so the files are never older`)
  return true
}

/** A hosted site's refusal, in the command's words, with the site's own reason. */
function refusal(error: unknown, lead: string, options: { hint?: string } = {}): CliError {
  const failure = classify(error)
  const withContent = error instanceof RemoteError && error.problem.code === 'removed-with-content'
  return new CliError(failure.kind, `${lead}: ${failure.message}`, {
    hint:
      options.hint ??
      (withContent ? '--retire retires the type and keeps its items.' : failure.hint),
    details: failure.details,
  })
}
