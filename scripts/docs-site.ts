/**
 * The product site's docs section, as data for `build:template` to write: the
 * guides in `sites/crombolo/docs/`, rendered from Markdown, and the reference
 * pages generated from the command line and the server's settings list.
 * `docs/stories/05_completed/157-a-docs-section-on-the-product-site.md`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { SETTING_SECTIONS, SETTINGS, type Setting, tomlValue } from '@crombolo/server'
import { Marked, type Token, type Tokens } from 'marked'
import {
  type CliReferencePage,
  cliIndexHtml,
  cliReferencePages,
  exitCodesHtml,
} from '../packages/cli/src/reference.ts'
import { listTemplates } from '../packages/cli/src/templates.ts'
import type {
  Walkthrough,
  WalkthroughStage,
  WalkthroughStep,
} from '../sites/crombolo/components/shared/walkthrough.tsx'
import { ROOT } from './packages.ts'
import { listSites } from './sites.ts'

export const DOCS_DIR = join(ROOT, 'sites/crombolo/docs')
type Manifest = Parameters<typeof cliReferencePages>[0]

const EDIT_BASE = 'https://github.com/kineco-au/crombolo-cms/edit/main/sites/crombolo/docs'
export const CLI_BASE = '/docs/reference/command-line/'

/** A docs page as the build writes it: one node, keyed by where it sits. */
export interface DocsPage {
  /** Its address under `/docs/`, without slashes: `guides/remotes`. */
  path: string
  name: string
  slug: string
  standfirst?: string
  body?: string
  /** A walkthrough page's steps, shown one at a time. */
  walkthrough?: Walkthrough
  generatedFrom?: string
  editUrl?: string
  children: DocsPage[]
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A Markdown renderer whose headings get ids, unique across everything it renders. */
function markdownRenderer(): Marked {
  const seen = new Map<string, number>()
  const marked = new Marked({ gfm: true })
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token) {
        const inner = this.parser.parseInline(token.tokens)
        const base = slugify(inner) || 'section'
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        const id = n === 0 ? base : `${base}-${n + 1}`
        return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`
      },
    },
  })
  return marked
}

/** Markdown to the markup the rich-text editor stores; headings get ids for "On this page". */
export function renderMarkdown(markdown: string): string {
  return (markdownRenderer().parse(markdown, { async: false }) as string).trim()
}

/** Inline markup as the words it shows. */
const textOf = (html: string): string =>
  html
    .replaceAll(/<[^>]+>/g, '')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

/**
 * A walkthrough page's steps (`walkthrough: true`): each `##` is a stage and
 * each `###` a step, holding a sentence, its code, and quotes for what to
 * expect. A quote opening in bold is a note to act on. Ids match the body's.
 * `choice` ("Database: SQLite, Postgres") lets the reader pick one option, and
 * a step whose heading ends "[Postgres]" is shown only for that one.
 */
export function walkthroughOf(file: string, markdown: string, choice?: string): Walkthrough {
  const [choiceName = '', list = ''] = (choice ?? '').split(/:\s*/)
  const options = list
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (choice && (!choiceName || options.length < 2))
    throw new Error(`${file}: a choice is "Name: one, another"`)
  const marked = markdownRenderer()
  const html = (tokens: Token[]) => (marked.parser(tokens) as string).trim()
  const heading = (token: Tokens.Heading) => {
    const match = /^<h\d id="([^"]*)">([\s\S]*)<\/h\d>$/.exec(html([token])) as RegExpExecArray
    return { id: match[1] as string, title: textOf(match[2] as string) }
  }
  const intro: Token[] = []
  const stages: WalkthroughStage[] = []
  let parts: { text: Token[]; see: Token[]; note: Token[] } | undefined
  const finish = () => {
    const step = stages.at(-1)?.steps.at(-1)
    if (!step || !parts) return
    if (parts.text.length === 0) throw new Error(`${file}: the step "${step.title}" says nothing`)
    step.text = html(parts.text)
    if (parts.see.length > 0) step.see = html(parts.see)
    if (parts.note.length > 0) step.note = html(parts.note)
  }
  for (const token of marked.lexer(markdown)) {
    if (token.type === 'heading' && token.depth <= 3) {
      finish()
      parts = undefined
      if (token.depth === 2) stages.push({ ...heading(token as Tokens.Heading), steps: [] })
      else {
        const stage = stages.at(-1)
        if (!stage) throw new Error(`${file}: a step comes before the first stage`)
        const { id, title } = heading(token as Tokens.Heading)
        const only = /\s*\[([^\]]+)\]$/.exec(title)
        if (only && !options.includes(only[1] as string))
          throw new Error(`${file}: the step "${title}" is for "${only[1]}", which is not a choice`)
        stage.steps.push({
          id,
          title: only ? title.slice(0, only.index) : title,
          ...(only ? { only: only[1] as string } : {}),
          text: '',
          code: [],
        })
        parts = { text: [], see: [], note: [] }
      }
    } else if (token.type === 'space') continue
    else if (!parts) {
      if (stages.length > 0) throw new Error(`${file}: a stage holds only steps`)
      intro.push(token)
    } else if (token.type === 'code') {
      const [lang = 'text', path] = ((token as Tokens.Code).lang ?? '').split(/\s+/)
      const step = (stages.at(-1) as WalkthroughStage).steps.at(-1) as WalkthroughStep
      step.code.push({
        lang: lang || 'text',
        ...(path ? { file: path } : {}),
        text: (token as Tokens.Code).text,
      })
    } else if (token.type === 'blockquote') {
      const inner = (token as Tokens.Blockquote).tokens
      ;(/^\s*>\s*\*\*/.test(token.raw) ? parts.note : parts.see).push(...inner)
    } else parts.text.push(token)
  }
  finish()
  for (const stage of stages)
    if (stage.steps.length === 0)
      throw new Error(`${file}: the stage "${stage.title}" has no steps`)
  return {
    intro: html(intro),
    ...(choice ? { choice: { name: choiceName, options } } : {}),
    stages,
  }
}

export interface Guide {
  file: string
  title: string
  summary: string
  order: number
  walkthrough: boolean
  /** A walkthrough's one choice, as "Name: one, another". */
  choice?: string
  body: string
}

/** A guide's front matter and body. Every field is required, so a page cannot ship half-described. */
export function parseGuide(file: string, text: string): Guide {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`${file}: no front matter`)
  const fields = new Map<string, string>()
  for (const line of (match[1] as string).split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const need = (name: string) => {
    const value = fields.get(name)
    if (!value) throw new Error(`${file}: front matter has no "${name}"`)
    return value
  }
  const order = Number(need('order'))
  if (!Number.isFinite(order)) throw new Error(`${file}: "order" is not a number`)
  const body = (match[2] as string).trim()
  if (/^# /m.test(body)) throw new Error(`${file}: the title is the page's heading; start at ##`)
  return {
    file,
    title: need('title'),
    summary: need('summary'),
    order,
    walkthrough: fields.get('walkthrough') === 'true',
    ...(fields.has('choice') ? { choice: fields.get('choice') } : {}),
    body,
  }
}

function readGuides(dir: string): Guide[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => parseGuide(name, readFileSync(join(dir, name), 'utf8')))
    .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file))
}

const guidePage = (folder: string, guide: Guide): DocsPage => {
  const slug = basename(guide.file, '.md')
  const relative = folder ? `${folder}/${guide.file}` : guide.file
  return {
    path: folder ? `${folder}/${slug}` : slug,
    name: guide.title,
    slug,
    standfirst: guide.summary,
    body: renderMarkdown(guide.body),
    ...(guide.walkthrough
      ? { walkthrough: walkthroughOf(relative, guide.body, guide.choice) }
      : {}),
    editUrl: `${EDIT_BASE}/${relative}`,
    children: [],
  }
}

const KIND_NOTES: Record<Setting['kind'], string> = {
  string: '',
  number: 'A number.',
  boolean: '<code>true</code> or <code>false</code>.',
  list: 'A comma-separated list.',
  enum: '',
}

function settingRow(setting: Setting): string {
  const notes = [
    escapeHtml(setting.description),
    setting.kind === 'enum' && setting.values
      ? `One of ${setting.values.map((v) => `<code>${escapeHtml(v)}</code>`).join(', ')}.`
      : KIND_NOTES[setting.kind],
    setting.appliesTo === 'cli' ? 'Read by the command line only.' : '',
    setting.secret ? 'Keep this secret: it is never shown back.' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const value = setting.default === undefined ? '—' : `<code>${escapeHtml(setting.default)}</code>`
  return `<tr><td><code>${escapeHtml(setting.env)}</code></td><td>${value}</td><td>${notes}</td></tr>`
}

/** Every setting, a table per section in the list's order. */
export function configurationHtml(settings: readonly Setting[] = SETTINGS): string {
  const parts = [
    '<p>Every setting the server and the command line read from the environment. A value in ' +
      '<code>crombolo.config.ts</code> wins over the environment, and the environment over the default. ' +
      'See the <a href="/docs/guides/configuration/">configuration guide</a> for where to start.</p>',
  ]
  for (const section of SETTING_SECTIONS) {
    const rows = settings.filter((setting) => setting.section === section)
    if (rows.length === 0) continue
    parts.push(`<h2 id="${slugify(section)}">${escapeHtml(section)}</h2>`)
    parts.push(
      `<table><thead><tr><th>Setting</th><th>Default</th><th>What it does</th></tr></thead><tbody>${rows
        .map(settingRow)
        .join('')}</tbody></table>`,
    )
  }
  return parts.join('\n')
}

const commandLinePage = (page: CliReferencePage): DocsPage => ({
  path: `reference/command-line/${page.slug}`,
  name: page.title,
  slug: page.slug,
  standfirst: page.summary,
  body: page.html,
  generatedFrom: 'the command line’s own description of its commands',
  children: [],
})

/** A template `crombolo init --template` offers, as its Getting started page tells it (story 256). */
export interface TemplateInfo {
  id: string
  name: string
  description: string
  /** It has a Next.js front end in `web/`. */
  next: boolean
  /** It ships content, applied and published on the first start. */
  seed: boolean
  /** The server bundles it brings, by package name. */
  bundles: string[]
  /** Its own words, from a `TEMPLATE.md` beside it. */
  notes?: string
}

const notesIn = (dir: string): string | undefined => {
  const file = join(dir, 'TEMPLATE.md')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined
}

/** The CLI's own templates, then each site it distributes: what `init --template list` offers. */
export function templateInfos(): TemplateInfo[] {
  const own = listTemplates(join(ROOT, 'packages/cli/templates')).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    next: t.next,
    seed: t.seed,
    bundles: t.serverBundles.map((b) => b.package),
    notes: notesIn(t.dir),
  }))
  const sites = listSites()
    .filter((site) => site.distribute)
    .map((site) => ({
      id: site.id,
      name: site.name,
      description: site.description,
      next: site.next,
      seed: existsSync(join(site.dir, 'content')),
      bundles: site.bundles.flatMap((b) =>
        b && typeof b === 'object' && typeof (b as { package?: unknown }).package === 'string'
          ? [(b as { package: string }).package]
          : [],
      ),
      notes: notesIn(site.dir),
    }))
  return [...own, ...sites]
}

const templateSlug = (id: string) => id.replaceAll('/', '-')

function templateMarkdown(t: TemplateInfo): string {
  const folder = templateSlug(t.id).replace(/^demo-/, '')
  const block = (...lines: string[]) => ['```sh', ...lines, '```'].join('\n')
  const parts = [
    `${t.name}: ${t.description}.`,
    '## Create it',
    block(
      `mkdir ${folder} && cd ${folder}`,
      `bunx @crombolo/cli@latest init --template ${t.id}`,
      'bun install',
    ),
    '## Start it',
    t.next ? block('bun run dev') : block('bun start'),
    t.next
      ? 'This runs the CMS on <http://localhost:8080/> and the Next.js front end in `web/` on <http://localhost:3000/>.'
      : 'The site is served on <http://localhost:8080/>.',
    `${t.seed ? "The first start applies the template's content and publishes it. " : ''}The back office is at <http://localhost:8080/crombolo>, and the start prints how to sign in ([Getting started](/docs/getting-started/#sign-in)).`,
  ]
  if (t.bundles.length > 0)
    parts.push(
      '## The bundles it brings',
      t.bundles.map((b) => `- \`${b}\``).join('\n'),
      'They are installed with the site, and wired in its `crombolo.config.ts`.',
    )
  if (t.notes) parts.push(t.notes)
  return parts.join('\n\n')
}

/** Templates, and a page for each, under Getting started. */
export function templatePages(templates = templateInfos()): DocsPage {
  const index = [
    'Each template is a site to start from: its types, views, styles and starting content. `init --template` scaffolds one into an empty folder.',
    '| Template | What it is |',
    '| --- | --- |',
    ...templates.map(
      (t) =>
        `| [${t.name}](/docs/getting-started/templates/${templateSlug(t.id)}/) | ${t.description} |`,
    ),
    'To list them from the command line:',
    '```sh\nbunx @crombolo/cli@latest init --template list\n```',
  ].join('\n\n')
  return {
    path: 'getting-started/templates',
    name: 'Templates',
    slug: 'templates',
    standfirst: 'A page for each template: what is in it, and how to create and start it.',
    body: renderMarkdown(index),
    generatedFrom: 'the templates the command line offers',
    children: templates.map((t) => ({
      path: `getting-started/templates/${templateSlug(t.id)}`,
      name: t.name,
      slug: templateSlug(t.id),
      standfirst: `crombolo init --template ${t.id}`,
      body: renderMarkdown(templateMarkdown(t)),
      generatedFrom: 'the template’s manifest and its TEMPLATE.md',
      children: [],
    })),
  }
}

/** The whole docs tree under the section, in reading order. */
export function docsTree(manifest: Manifest, dir = DOCS_DIR): DocsPage[] {
  // A top page's folder holds its pages: getting-started.md, then getting-started/*.md
  const top = readGuides(dir).map((guide) => {
    const page = guidePage('', guide)
    const children = readGuides(join(dir, page.slug)).map((g) => guidePage(page.slug, g))
    if (page.slug === 'getting-started') children.push(templatePages())
    return { ...page, children }
  })
  const guides = readGuides(join(dir, 'guides')).map((guide) => guidePage('guides', guide))
  const commands = cliReferencePages(manifest)
  return [
    ...top,
    {
      path: 'guides',
      name: 'Guides',
      slug: 'guides',
      standfirst: 'How the pieces fit together, from the content model to running in production.',
      children: guides,
    },
    {
      path: 'reference',
      name: 'Reference',
      slug: 'reference',
      standfirst: 'Every command, setting and exit code, generated from the product itself.',
      children: [
        {
          path: 'reference/command-line',
          name: 'Command line',
          slug: 'command-line',
          standfirst: 'Every crombolo command: what it takes, what it changes and how it fails.',
          body: cliIndexHtml(commands, CLI_BASE),
          generatedFrom: 'the command line’s own description of its commands',
          children: commands.map(commandLinePage),
        },
        {
          path: 'reference/configuration',
          name: 'Configuration',
          slug: 'configuration',
          standfirst: 'Every setting, its default and what it does.',
          body: configurationHtml(),
          generatedFrom: 'the list of settings the server reads',
          children: [],
        },
        {
          path: 'reference/exit-codes',
          name: 'Exit codes',
          slug: 'exit-codes',
          standfirst: 'What each exit code means, and the error a script can read.',
          body: exitCodesHtml(manifest),
          generatedFrom: 'the command line’s list of errors',
          children: [],
        },
      ],
    },
  ]
}

/** A uuid-shaped digest of a seed: the same page gets the same key on every build. */
export function stableKey(seed: string): string {
  const hex = new Bun.CryptoHasher('sha256').update(seed).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

export const docsKey = (path: string): string => stableKey(`docs:${path}`)

/** The first line of a docs content file: what to edit instead. */
export const GENERATED_HEADER = '# Generated by `bun run build:template`'

/** Where the docs section's generated content files live in the product site. */
export const DOCS_SEED_DIR = join(ROOT, 'sites/crombolo/content/pages/home/docs')

/**
 * The docs section's generated pages as seed files (story 164): one per guide
 * and reference page, at its own path, with the key it has always had. Each
 * says it is generated and what to edit instead; the docs page and its search
 * page beside them are written by hand and left alone.
 */
export function writeDocsSeed(manifest: Manifest, dir = DOCS_SEED_DIR): string[] {
  for (const file of readdirSync(dir, { recursive: true }) as string[]) {
    const path = join(dir, file)
    if (file.endsWith('.toml') && readFileSync(path, 'utf8').startsWith(GENERATED_HEADER))
      rmSync(path)
  }
  const written: string[] = []
  const write = (item: DocsPage, order: number) => {
    const source = item.generatedFrom ?? item.editUrl?.split('/main/')[1] ?? 'sites/crombolo/docs/'
    const values: Array<[string, unknown]> = [
      ['title', item.name],
      ['standfirst', item.standfirst],
      ['body', item.body === undefined ? undefined : { html: item.body }],
      ['walkthrough', item.walkthrough && JSON.stringify(item.walkthrough)],
      ['generatedFrom', item.generatedFrom],
      ['editUrl', item.editUrl],
      ['umbracoUrlName', item.slug],
    ]
    const lines = [
      `${GENERATED_HEADER} from ${source}: edit that, not this file.`,
      'type = "docsPage"',
      `key = ${JSON.stringify(docsKey(item.path))}`,
      `name = ${JSON.stringify(item.name)}`,
      `order = ${order}`,
      '',
      '[values]',
      ...values.flatMap(([alias, value]) => {
        const text = tomlValue(value)
        return text === undefined ? [] : [`${alias} = ${text}`]
      }),
    ]
    const file = join(dir, `${item.path}.toml`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${lines.join('\n')}\n`)
    written.push(file)
    for (const [index, child] of item.children.entries()) write(child, index)
  }
  for (const [index, item] of docsTree(manifest).entries()) write(item, index)
  return written
}
