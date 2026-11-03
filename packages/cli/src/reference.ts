/**
 * The command line reference as HTML, for the product site's docs: built from
 * the CLI manifest's data, through the same clispec description
 * `crombolo schema` prints, so the pages cannot say anything the CLI does not.
 */
import type { Interfaces } from '@oclif/core'
import { clispecDocument } from './clispec.ts'

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const code = (text: string) => `<code>${escapeHtml(text)}</code>`

interface Arg {
  name: string
  type: string
  short?: string
  required?: boolean
  default?: unknown
  enum?: unknown[]
  description?: string
}

/** One page of the reference: the topics, by the first word of a command, it covers. */
export interface CliPageSpec {
  slug: string
  title: string
  summary: string
  topics: readonly string[]
}

/** Where each topic is documented. A new topic has to be placed here, or the reference test fails. */
export const CLI_PAGES: readonly CliPageSpec[] = [
  {
    slug: 'sites',
    title: 'Sites',
    summary: 'Create a site, start it, check on it, and describe the command line to a script.',
    topics: ['init', 'start', 'status', 'health', 'generate', 'export', 'schema'],
  },
  {
    slug: 'types',
    title: 'Content types',
    summary:
      'Check, apply and change the content model kept in schema/: types, languages, forms, workflows, webhooks and page addresses.',
    topics: ['types', 'languages', 'forms', 'workflows', 'webhooks', 'site'],
  },
  {
    slug: 'components',
    title: 'Components and assets',
    summary:
      'Create and check the templates under components/, and the styles and scripts beside them.',
    topics: ['components', 'assets'],
  },
  {
    slug: 'content',
    title: 'Content and media',
    summary: 'Pages, media, the dictionary, domains and the recycle bin.',
    topics: ['content', 'media', 'dictionary', 'domains', 'recycle-bin'],
  },
  {
    slug: 'remotes',
    title: 'Remotes, pull and push',
    summary: 'Sign in to another environment, and move content and schema between them.',
    topics: ['login', 'logout', 'whoami', 'remote', 'pull', 'push', 'bundle'],
  },
  {
    slug: 'import',
    title: 'Importing from Umbraco',
    summary: 'Bring an Umbraco site’s content types, content and media across.',
    topics: ['import'],
  },
  {
    slug: 'users',
    title: 'Users and access',
    summary: 'Back office users, the administrator’s password, API clients and the audit log.',
    topics: ['users', 'admin', 'api-client', 'audit'],
  },
  {
    slug: 'operations',
    title: 'Operations',
    summary:
      'Caches, the search index, maintenance pauses, outgoing changes, upgrades and restarts.',
    topics: ['cache', 'index', 'maintenance', 'events', 'upgrade', 'restart'],
  },
]

export interface CliReferencePage extends CliPageSpec {
  html: string
  /** The commands on the page, as typed: `content publish`. */
  commands: string[]
}

function usage(name: string, args: Arg[]): string {
  const words = args.map((arg) => {
    if (!arg.name.startsWith('--')) return arg.required ? `<${arg.name}>` : `[<${arg.name}>]`
    const flag = arg.type === 'boolean' ? arg.name : `${arg.name} <${arg.name.slice(2)}>`
    return arg.required ? flag : `[${flag}]`
  })
  return ['crombolo', name, ...words].join(' ')
}

/** A summary written for `--help` — "apply schema/ to the database" — as a sentence. */
const sentence = (text: string): string => {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const capital = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
  return /[.!?]$/.test(capital) ? capital : `${capital}.`
}

function argRow(arg: Arg): string {
  const name = [arg.short, arg.name].filter(Boolean).join(', ')
  const notes = [
    arg.description ? escapeHtml(sentence(arg.description)) : '',
    arg.enum ? `One of ${arg.enum.map((v) => code(String(v))).join(', ')}.` : '',
    arg.default !== undefined ? `Default ${code(String(arg.default))}.` : '',
    arg.required ? 'Required.' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return `<tr><td>${code(name)}</td><td>${notes}</td></tr>`
}

const EFFECTS: Record<string, string> = {
  read_only: 'Changes nothing.',
  idempotent: 'Safe to run again: a second run changes nothing more.',
  non_idempotent: 'Each run acts again.',
}

const documentOf = (manifest: Interfaces.Manifest) =>
  clispecDocument({
    bin: 'crombolo',
    version: manifest.version,
    commands: Object.values(manifest.commands),
  })

type Command = ReturnType<typeof documentOf>['commands'][number]

const topicOf = (command: Command) => String(command.name).split(' ')[0] as string

/** The anchor a command has on its page: `content publish` → `content-publish`. */
export const commandAnchor = (name: string): string => name.replaceAll(' ', '-')

function commandHtml(command: Command): string {
  const name = String(command.name)
  const args = ((command.args as Arg[] | undefined) ?? []).slice()
  const parts = [
    `<h2 id="${escapeHtml(commandAnchor(name))}">${code(`crombolo ${name}`)}</h2>`,
    `<p>${escapeHtml(sentence(String(command.description)))} ${EFFECTS[String(command.effects)] ?? ''}</p>`,
    `<pre><code>${escapeHtml(usage(name, args))}</code></pre>`,
  ]
  if (args.length > 0)
    parts.push(
      `<table><thead><tr><th>Argument</th><th>What it is</th></tr></thead><tbody>${args.map(argRow).join('')}</tbody></table>`,
    )
  return parts.join('\n')
}

/** The topics no page in `CLI_PAGES` covers. */
export function unplacedTopics(manifest: Interfaces.Manifest): string[] {
  const placed = new Set(CLI_PAGES.flatMap((page) => page.topics))
  return [...new Set(documentOf(manifest).commands.map(topicOf))].filter((t) => !placed.has(t))
}

/**
 * One page per entry in `CLI_PAGES`, in its order. A topic no page names — a
 * plugin's, say — gets a page of its own after them, so nothing is dropped.
 */
export function cliReferencePages(manifest: Interfaces.Manifest): CliReferencePage[] {
  const commands = documentOf(manifest).commands
  const specs = [
    ...CLI_PAGES,
    ...unplacedTopics(manifest).map((topic) => ({
      slug: topic,
      title: topic,
      summary: `The ${topic} commands.`,
      topics: [topic],
    })),
  ]
  return specs
    .map((spec) => {
      const on = spec.topics.flatMap((topic) => commands.filter((c) => topicOf(c) === topic))
      return {
        ...spec,
        commands: on.map((c) => String(c.name)),
        html: on.map(commandHtml).join('\n'),
      }
    })
    .filter((page) => page.commands.length > 0)
}

/** The front page of the reference: what every command shares, then each page and its commands. */
export function cliIndexHtml(pages: readonly CliReferencePage[], base: string): string {
  const parts = [
    `<p>Every command, generated from the CLI itself. Each takes ${code('--help')} for its entry ` +
      `here, and ${code('-o json')} for a result a script can read. ${code('crombolo schema')} prints ` +
      'the same description for a machine, as a <a href="https://clispec.dev">clispec</a> document. ' +
      'A command that fails exits with a code saying why: see the <a href="/docs/reference/exit-codes/">exit codes</a>.</p>',
  ]
  for (const page of pages) {
    const url = `${base}${page.slug}/`
    parts.push(
      `<h2 id="${escapeHtml(page.slug)}"><a href="${url}">${escapeHtml(page.title)}</a></h2>`,
    )
    parts.push(`<p>${escapeHtml(page.summary)}</p>`)
    parts.push(
      `<ul>${page.commands
        .map(
          (name) =>
            `<li><a href="${url}#${commandAnchor(name)}">${code(`crombolo ${name}`)}</a></li>`,
        )
        .join('')}</ul>`,
    )
  }
  return parts.join('\n')
}

/** The exit codes and the error envelope, from the CLI's own list. */
export function exitCodesHtml(manifest: Interfaces.Manifest): string {
  const document = documentOf(manifest)
  const rows = [
    ...document.errors.map((e) => [String(e.exit_code), e.kind, e.description] as const),
    ...document.outcomes.map((o) => [String(o.code), o.name, o.description] as const),
  ].sort((a, b) => Number(a[0]) - Number(b[0]))
  return [
    '<h2 id="codes">The codes</h2>',
    `<p>A command that succeeds exits with ${code('0')}. A failure exits with its kind's code, and a ` +
      "check that finds what it looks for exits with an outcome's code, its findings being its output.</p>",
    `<table><thead><tr><th>Code</th><th>Kind</th><th>When</th></tr></thead><tbody>${rows
      .map(
        ([codeNumber, kind, description]) =>
          `<tr><td>${codeNumber}</td><td>${code(kind)}</td><td>${escapeHtml(description).replaceAll(/`([^`]+)`/g, '<code>$1</code>')}</td></tr>`,
      )
      .join('')}</tbody></table>`,
    '<h2 id="envelope">The error envelope</h2>',
    `<p>With ${code('-o json')}, or whenever stderr is not a terminal, the last line of stderr is a JSON ` +
      'object naming the kind, so a script can tell a missing page from a refused one without reading the message.</p>',
    `<pre><code>${escapeHtml(
      JSON.stringify(
        {
          error: {
            kind: 'not_found',
            message: 'There is no page at /about/team.',
            hint: "Check the page's path or key.",
            exit_code: 5,
          },
        },
        null,
        2,
      ),
    )}</code></pre>`,
    `<p>${code('hint')}, ${code('details')} and ${code('retryable')} appear only when there is something to say.</p>`,
  ].join('\n')
}

const mdCode = (text: string) => `\`${text.replaceAll('`', 'ˋ')}\``
const mdCell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

interface OutputField {
  name: string
  type: string
  fields?: OutputField[]
  items?: { type: string; fields?: OutputField[] }
}

function fieldLines(fields: readonly OutputField[], depth = 0): string[] {
  return fields.flatMap((f) => {
    const type = f.type === 'array' && f.items ? `array of ${f.items.type}` : f.type
    const inner = f.fields ?? f.items?.fields ?? []
    return [`${'  '.repeat(depth)}- ${mdCode(f.name)} (${type})`, ...fieldLines(inner, depth + 1)]
  })
}

function commandMarkdown(command: Command): string {
  const name = String(command.name)
  const args = (command.args as Arg[] | undefined) ?? []
  const out = [
    `### ${mdCode(`crombolo ${name}`)}`,
    '',
    `${sentence(String(command.description))} ${EFFECTS[String(command.effects)] ?? ''}`.trim(),
    '',
    '```',
    usage(name, args),
    '```',
  ]
  if (args.length > 0) {
    out.push('', '| Argument | Type | What it is |', '| --- | --- | --- |')
    for (const arg of args) {
      const notes = [
        arg.description ? sentence(arg.description) : '',
        arg.enum ? `One of ${arg.enum.map((v) => mdCode(String(v))).join(', ')}.` : '',
        arg.default !== undefined ? `Default ${mdCode(String(arg.default))}.` : '',
        arg.required ? 'Required.' : '',
      ].filter(Boolean)
      out.push(
        `| ${mdCode([arg.short, arg.name].filter(Boolean).join(', '))} | ${arg.type} | ${mdCell(notes.join(' '))} |`,
      )
    }
  }
  const fields = command.output_fields as OutputField[] | undefined
  if (command.output_kind) out.push('', `**Output:** ${String(command.output_kind)}.`)
  else
    out.push(
      '',
      `**Output** (${String(command.cardinality)}, with \`-o json\`)${fields?.length ? ':' : ': a JSON document.'}`,
    )
  if (fields?.length) out.push('', ...fieldLines(fields))
  const errors = (command.errors as string[] | undefined) ?? []
  out.push('', `**Fails with:** ${errors.map(mdCode).join(', ')}.`)
  const outcomes = (command.outcomes as string[] | undefined) ?? []
  if (outcomes.length > 0) out.push('', `**Outcomes:** ${outcomes.map(mdCode).join(', ')}.`)
  return out.join('\n')
}

/**
 * The whole command line as one Markdown document, for the repository
 * (story 256): every command by topic, then the exit codes. Built from the same
 * description as the reference pages and `crombolo schema`.
 */
export function cliMarkdown(manifest: Interfaces.Manifest): string {
  const document = documentOf(manifest)
  const pages = cliReferencePages(manifest)
  const byName = new Map(document.commands.map((c) => [String(c.name), c]))
  const out = [
    '# The crombolo command line',
    '',
    '<!-- Generated by `bun run cli:spec` from the commands themselves. Do not edit. -->',
    '',
    `Every command, its arguments, what it changes, what it prints with ${mdCode('-o json')} and how it fails. ` +
      `${mdCode('clispec.json')} beside this file is the same description for a machine, as ` +
      `${mdCode('crombolo schema')} prints it (https://clispec.dev).`,
    '',
    'Every command also takes:',
    '',
    `- ${mdCode('-o, --output <text|json>')}: text for people, or JSON for scripts, on stdout;`,
    `- ${mdCode('--json')}: the same as ${mdCode('-o json')}.`,
  ]
  for (const page of pages) {
    out.push('', `## ${page.title}`, '', page.summary)
    for (const name of page.commands) {
      const command = byName.get(name)
      if (command) out.push('', commandMarkdown(command))
    }
  }
  out.push('', '## Exit codes', '', '| Code | Kind | When |', '| --- | --- | --- |')
  const rows = [
    ...document.errors.map((e) => [String(e.exit_code), e.kind, e.description] as const),
    ...document.outcomes.map((o) => [String(o.code), o.name, o.description] as const),
  ].sort((a, b) => Number(a[0]) - Number(b[0]))
  for (const [codeNumber, kind, description] of rows)
    out.push(`| ${codeNumber} | ${mdCode(kind)} | ${mdCell(description)} |`)
  return `${out.join('\n')}\n`
}

/** The clispec document for the repository: as `crombolo schema` prints it, less the version. */
export function cliSpecJson(manifest: Interfaces.Manifest): string {
  const { version: _version, ...document } = documentOf(manifest)
  return `${JSON.stringify(document, null, 2)}\n`
}
