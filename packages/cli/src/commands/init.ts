import { readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { cwd } from '../support/site.ts'
import { findTemplate, listTemplates, scaffoldFiles } from '../templates.ts'

/** What may already be in a folder `init` scaffolds into: a fresh repository, and macOS's folder settings. */
const IGNORED = new Set(['.git', '.DS_Store'])

/** The entries of a folder that make it not empty for `init`. */
export const occupying = (dir: string): string[] =>
  readdirSync(dir).filter((name) => !IGNORED.has(name))

export default class Init extends BaseCommand {
  static override summary = 'scaffold a site in the current, empty directory'
  static override description =
    'Either a plain site, or one from a --template with its schema, views and content; `--template list` prints the templates. Run it once, in an empty directory.'
  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --template list',
    '<%= config.bin %> init --template next',
  ]
  static override flags = {
    force: Flags.boolean({
      summary: 'scaffold into a directory that is not empty, overwriting its files',
    }),
    name: Flags.string({ summary: "the site's name", helpValue: '<site name>' }),
    next: Flags.boolean({
      summary: 'add a Next.js front end in web/, whatever the template',
      allowNo: true,
    }),
    postgres: Flags.boolean({ summary: 'configure Postgres rather than SQLite' }),
    template: Flags.string({ summary: 'a starter template, or `list`', helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'bounded',
    outputFields: [
      { name: 'created', type: 'array', items: { type: 'string' } },
      { name: 'templates', type: 'array', items: { type: 'object' } },
    ],
    errors: ['not_found', 'refused'],
  } as const

  async run() {
    const { flags } = await this.parse(Init)
    if (flags.template === 'list') {
      const templates = listTemplates().map((t) => ({ id: t.id, description: t.description }))
      for (const t of templates) this.say(`  ${t.id.padEnd(20)} ${t.description}`)
      this.say('\n  (no --template scaffolds the files and no content)')
      this.changedNothing = true
      return { created: [], templates }
    }
    const template = flags.template ? findTemplate(flags.template) : undefined
    if (flags.template && !template)
      this.fail(
        'not_found',
        `No template "${flags.template}".`,
        '`crombolo init --template list` prints them.',
      )

    const here = occupying(cwd())
    if (here.length > 0 && !flags.force)
      this.fail(
        'refused',
        `This directory is not empty (${here.slice(0, 3).join(', ')}${here.length > 3 ? ', …' : ''}).`,
        'Run `crombolo init` once, in an empty directory: either plain or with --template. --force scaffolds here anyway, overwriting its files.',
      )

    const created: string[] = []
    for (const file of scaffoldFiles({
      siteName: flags.name,
      postgres: flags.postgres,
      template,
      next: flags.next,
    })) {
      const target = join(cwd(), file.path)
      await mkdir(join(target, '..'), { recursive: true })
      if (file.copyFrom === undefined) await writeFile(target, file.text ?? '')
      else await Bun.write(target, Bun.file(file.copyFrom))
      created.push(file.path)
      this.say(`  created  ${file.path}`)
    }

    const next = flags.next ?? template?.next ?? false
    this.say(
      next
        ? '\nNext:\n  bun install\n  bun run dev     # the CMS on :8080, the Next.js app in web/ on :3000'
        : '\nNext:\n  bun install\n  bun start',
    )
    if (template?.seed)
      this.say(
        '\n`bun start` applies seed/ on the first boot, and again after you change it:\n' +
          'the starting content is files to edit. `crombolo seed check` checks them.',
      )
    return { created, templates: [] }
  }
}
