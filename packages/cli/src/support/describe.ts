/** How the CLI says what happened: the lines shared between commands. */
import { relative } from 'node:path'
import type { Finding } from '@crombolo/data'
import {
  type LocatedProblem,
  locateProblems,
  type ProblemDefinition,
  type SchemaProblem,
  type SyncReport,
} from '@crombolo/schema'
import { propertyHandle, resolutionsFor, type TransferCheck } from '@crombolo/transfer'
import type * as ops from '../operations/commands.ts'
import type { Job } from '../remote/client.ts'
import { cwd, type Io } from './site.ts'

export function banner(io: Io, lines: string[]): void {
  const width = Math.max(...lines.map((line) => line.length))
  io.say(`┌─${'─'.repeat(width)}─┐`)
  for (const line of lines) io.say(`│ ${line.padEnd(width)} │`)
  io.say(`└─${'─'.repeat(width)}─┘`)
}

export const here = (path: string): string => relative(cwd(), path) || '.'

/** Bytes as somebody reads them, since a bundle of media is measured in them. */
export function describeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export const counted = (counts: Record<string, number>, none = 'nothing'): string => {
  const entries = Object.entries(counts)
  return entries.length > 0 ? entries.map(([kind, n]) => `${n} ${kind}`).join(', ') : none
}

/**
 * Puts the media files a bundle carries into this environment's store.
 *
 * After the content, because the run is what decides whether any of this
 * happened: a refused import leaves the store alone.
 */
export function describePlaced(
  placed: { placed: number; bytes: number } | null,
): string | undefined {
  if (!placed) return undefined
  return `${placed.placed} media file(s) placed, ${describeBytes(placed.bytes)}`
}

export function describeSync(report: SyncReport): string {
  switch (report.action) {
    case 'applied':
    case 'would-apply': {
      const verb = report.action === 'applied' ? 'applied' : 'would apply'
      const c = report.created
      const parts = [
        `${c.types} type(s)`,
        `${c.properties} propert${c.properties === 1 ? 'y' : 'ies'}`,
        `${c.dataTypes} data type(s)`,
        `${c.languages} language(s)`,
      ]
      const extra = [
        report.retired.length > 0 ? `retired ${report.retired.join(', ')}` : '',
        report.retiredTypes.length > 0 ? `retired types ${report.retiredTypes.join(', ')}` : '',
        report.revived.length > 0 ? `revived ${report.revived.join(', ')}` : '',
        report.assignedKeys.length > 0 ? `${report.assignedKeys.length} key(s) assigned` : '',
      ].filter(Boolean)
      return `${verb} ${report.state?.version ?? ''}: created ${parts.join(', ')}${extra.length > 0 ? `; ${extra.join('; ')}` : ''}`
    }
    case 'skipped-same':
      return 'up to date'
    case 'skipped-older':
      return `compatibility mode: ${report.reason ?? ''}`
    case 'refused':
      return `refused: ${report.reason ?? `${report.problems.length} problem(s)`}`
  }
}

/** A definition as a person names it: the content type "Content page". */
export function describeDefinition(definition: ProblemDefinition): string {
  if (definition.kind === 'languages') return "the site's languages"
  if (definition.kind === 'site settings') return "the site's settings"
  return `the ${definition.kind} "${definition.name ?? definition.alias}"`
}

const arg = (text: string) => (/^[A-Za-z0-9_.@/-]+$/.test(text) ? text : `"${text}"`)

const TYPE_KINDS = new Set(['content type', 'element type', 'media type', 'member type'])

/** The command that changes what a problem is about. */
function fixFor({ definition, part }: LocatedProblem): string | undefined {
  if (!definition) return undefined
  const alias = arg(definition.alias)
  const on = part ? arg(part.name) : ''
  if (TYPE_KINDS.has(definition.kind))
    return part?.kind === 'property'
      ? `crombolo types property update ${alias} ${on}`
      : `crombolo types update ${alias}`
  switch (definition.kind) {
    case 'data type':
      return `crombolo types update ${alias}`
    case 'form':
      if (part && ['field', 'page', 'group', 'workflow'].includes(part.kind))
        return `crombolo forms ${part.kind} update ${alias} ${on}`
      return `crombolo forms update ${alias}`
    case 'workflow':
      return part?.kind === 'stage'
        ? `crombolo workflows stage update ${alias} ${on}`
        : `crombolo workflows update ${alias}`
    case 'user group':
      return `crombolo users groups update ${alias}`
    case 'languages':
      return part?.kind === 'language'
        ? `crombolo languages update ${on}`
        : 'crombolo languages list'
    case 'site settings':
      return 'crombolo site urls'
  }
}

const SYNTAX = /^invalid TOML: (?:TOML Parse error: )?/

/** One problem in words: its definition and part, or its file and line when the file does not read. */
export function describeLocated(problem: LocatedProblem): string {
  if (!problem.definition) {
    const at = `${problem.file}${problem.line ? `, line ${problem.line}` : ''}`
    return SYNTAX.test(problem.message)
      ? `${at} does not read: ${problem.message.replace(SYNTAX, '')}`
      : `${at}: ${problem.message}`
  }
  const what = describeDefinition(problem.definition)
  const part = problem.part ? `, its ${problem.part.kind} "${problem.part.name}"` : ''
  // A message that names its own command needs no other
  const fix = problem.message.includes('`crombolo ') ? undefined : fixFor(problem)
  // The reader's own words name no key: "is required", "expected a string"
  const key = problem.key?.replace(/^settings\./, '')
  const generic = /^(is required|expected |unknown key)/.test(problem.message)
  const message =
    key && generic
      ? problem.message.startsWith('is ')
        ? `${key} ${problem.message}`
        : `${key}: ${problem.message}`
      : problem.message
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}${part}: ${message}${fix ? ` (\`${fix}\`)` : ''}`
}

/** A problem for output: in words, with where it is kept for tools. */
export interface ProblemOut {
  text: string
  message: string
  definition?: ProblemDefinition
  part?: { kind: string; name: string }
  key?: string
  file: string
  line?: number
}

/** Problems in the site's own terms, each with its file and line for `-o json`. */
export function problemsOf(problems: readonly SchemaProblem[], schemaDir: string): ProblemOut[] {
  return locateProblems(problems, schemaDir).map((p) => ({
    text: describeLocated(p),
    message: p.message,
    ...(p.definition ? { definition: p.definition } : {}),
    ...(p.part ? { part: p.part } : {}),
    ...(p.key ? { key: p.key } : {}),
    file: p.file,
    ...(p.line !== undefined ? { line: p.line } : {}),
  }))
}

export function printProblems(io: Io, problems: readonly ProblemOut[]): void {
  for (const p of problems) io.warning(`  ${p.text}`)
}

export function describeBundle(io: Io, bundle: ops.BundleSummary): void {
  io.say(
    `  bundle   ${bundle.id} from ${bundle.from || 'elsewhere'} ` +
      `(schema ${bundle.schemaVersion}+${bundle.schemaRevision}, ` +
      `${bundle.snapshot} snapshot, ${bundle.nodes} node(s))`,
  )
  if (bundle.blobsCarried > 0)
    io.say(
      `  blobs    ${bundle.blobsCarried} media file(s) carried, ${describeBytes(bundle.blobBytes)}`,
    )
  if (bundle.carriesCode) io.say(CARRIES_CODE)
}

/** An import installs a bundle's content and never its code, so it says there is code to install. */
export const CARRIES_CODE =
  '  code     carried, and not installed by an import: `crombolo extension install <bundle> --code-into <dir>` installs it'

/**
 * What a site package replaces that decides how the site runs, said before
 * anything else (story 306): its config, its package.json and the dependencies
 * that changes.
 */
export function printSitePackage(io: Io, changes: ops.SitePackageChanges | undefined): void {
  if (!changes) return
  io.say("  Site package: replaces this site's code, config and dependencies")
  const what = (action: string | null) =>
    action === 'create' ? 'added' : action === 'overwrite' ? 'REPLACED' : 'the same'
  if (changes.config) io.say(`  config   crombolo.config.ts ${what(changes.config)}`)
  if (changes.packageJson) io.say(`  package  package.json ${what(changes.packageJson)}`)
  const { added, removed, changed } = changes.dependencies
  for (const name of added) io.say(`    adds     ${name}`)
  for (const name of removed) io.say(`    removes  ${name}`)
  for (const name of changed) io.say(`    changes  ${name}`)
}

/** What the carried sections would do, or did. */
export function printSections(io: Io, plan: ops.SectionPlan | undefined): void {
  if (!plan) return
  io.say(`  carries  ${plan.sections.join(', ')}`)
  const counts = new Map<string, number>()
  for (const file of plan.files) counts.set(file.action, (counts.get(file.action) ?? 0) + 1)
  const summary = [...counts].map(([action, n]) => `${n} ${action}`).join(', ')
  if (summary) io.say(`  files    ${summary}`)
  for (const file of plan.files)
    if (file.action === 'overwrite') io.say(`    overwrites ${here(file.target)}`)
  if (plan.dictionaryItems > 0) io.say(`  dict     ${plan.dictionaryItems} file(s)`)
  if (plan.schema) {
    io.say(`  schema   ${plan.schema.classification}`)
    for (const finding of plan.schema.findings) io.say(`    ${finding}`)
  }
  for (const migration of plan.migrations ?? [])
    io.say(`  migrates ${migration}: runs at install, not during a check`)
}

export function printTransferFindings(io: Io, check: TransferCheck): void {
  const byKind = { blocking: 0, person: 0, auto: 0 }
  for (const f of check.findings) byKind[f.kind] += 1
  const c = check.counts
  io.say(
    `  plan     ${c.create} new, ${c.update} updated, ${c.unchanged} unchanged, ${c.skip} skipped`,
  )
  io.say(
    `  findings ${byKind.blocking} blocking, ${byKind.person} need a person, ${byKind.auto} automatic`,
  )
  for (const f of check.findings) {
    io.say(`  [${f.kind.padEnd(8)}] ${f.message}`)
    // The handle is the CLI's to name; the dashboard offers the same answers as choices.
    if (f.code === 'local-edit' && f.propertyAlias)
      io.say(
        `             answer it as ${f.subjectKey}/${propertyHandle(f.propertyAlias, f.culture)}`,
      )
    for (const suggestion of resolutionsFor(f.code)) io.say(`             → ${suggestion}`)
    if (f.link) io.say(`             ${f.link}`)
  }
}

/** The findings a check reports, as data: what the envelope's `details` carry. */
export const findingsOf = (
  findings: readonly { kind: string; message: string; code?: string; link?: string | null }[],
) =>
  findings.map((f) => ({
    kind: f.kind,
    ...(f.code ? { code: f.code } : {}),
    message: f.message,
    ...(f.link ? { link: f.link } : {}),
  }))

export function printFindings(
  io: Io,
  report: { classification: string; findings: Finding[] },
): void {
  const byKind = { blocking: 0, person: 0, auto: 0 }
  for (const f of report.findings) byKind[f.kind] += 1
  io.say(
    `change: ${report.classification}; findings: ${byKind.blocking} blocking, ${byKind.person} need a person, ${byKind.auto} automatic`,
  )
  for (const f of report.findings) {
    const where = f.link ? `  ${f.link}` : ''
    io.say(`  [${f.kind.padEnd(8)}] ${f.message}${where}`)
  }
}

export const describeJob = (job: Job): string =>
  `  ${job.kind.padEnd(5)} ${job.state}${job.stage ? `, ${job.stage}` : ''}${job.progress != null ? ` (${job.progress}%)` : ''}`

export function describeContentMode(
  io: Io,
  content: 'omitted' | 'sealed' | 'open',
  people?: { members: number; users: number },
): void {
  if (content === 'omitted')
    io.say(
      '  content  not included: pages are placed and named, and no value is written. Pass --include-content to bring the values and media files',
    )
  else if (content === 'sealed') io.say('  content  encrypted: importing needs the passphrase')
  else io.say('  content  unencrypted')
  if (people && people.members + people.users > 0)
    io.say(`  people   ${people.members} member(s), ${people.users} user(s), encrypted`)
}
