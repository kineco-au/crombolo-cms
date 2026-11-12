import { readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { cwd } from '../support/site.ts'
import { DEFAULT_SITE_NAME, findTemplate, listTemplates, scaffoldFiles } from '../templates.ts'

/** What a plain `init` scaffolds: a Content Page type, its template and a welcome page (story 341). */
export const DEFAULT_TEMPLATE = 'basic'

/** What may already be in a folder `init` scaffolds into: a fresh repository, and macOS's folder settings. */
const IGNORED = new Set(['.git', '.DS_Store'])

/** The entries of a folder that make it not empty for `init`. */
export const occupying = (dir: string): string[] =>
  readdirSync(dir).filter((name) => !IGNORED.has(name))

export default class Init extends BaseCommand {
  static override summary = 'scaffold a site in the current, empty directory'
  static override description =
    'A site with a Content Page type, its template and a welcome page; or one from a --template with its schema, views and content; or, with --empty, none of them. `--template list` prints the templates. Run it once, in an empty directory.'
  static override examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --empty',
    '<%= config.bin %> init --template list',
    '<%= config.bin %> init --template next',
  ]
  static override flags = {
    empty: Flags.boolean({
      summary: 'scaffold the files and no type, template or page',
      exclusive: ['template'],
    }),
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
    verbose: Flags.boolean({ summary: 'list every file it writes' }),
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
      this.say(
        `\n  (no --template is ${DEFAULT_TEMPLATE}; --empty scaffolds the files and no content)`,
      )
      this.changedNothing = true
      return { created: [], templates }
    }
    const id = flags.empty ? undefined : (flags.template ?? DEFAULT_TEMPLATE)
    const template = id ? findTemplate(id) : undefined
    if (id && !template)
      this.fail('not_found', `No template "${id}".`, '`crombolo init --template list` prints them.')

    const here = occupying(cwd())
    if (here.length > 0 && !flags.force)
      this.fail(
        'refused',
        `This directory is not empty (${here.slice(0, 3).join(', ')}${here.length > 3 ? ', …' : ''}).`,
        'Run `crombolo init` once, in an empty directory. --force scaffolds here anyway, overwriting its files.',
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
      if (flags.verbose) this.say(`  created  ${file.path}`)
    }

    const next = flags.next ?? template?.next ?? false
    const name = flags.name ?? DEFAULT_SITE_NAME
    this.say(
      `A site called "${name}", on ${flags.postgres ? 'Postgres' : 'SQLite'}` +
        `${flags.template && template ? `, from the template "${template.id}"` : template ? ', with a Content Page type and a welcome page' : ''}` +
        `${next ? ', with a Next.js front end in web/' : ''}.`,
    )
    this.say("Its definitions are kept in schema/: commit it with the rest of the site's code.")
    if (next)
      this.say(
        '\nNext:\n  bun install\n  bun run dev     # the CMS on :8080, the Next.js app in web/ on :3000',
      )
    else if (template) this.say('\nNext:\n  bun install\n  bun start')
    else
      this.say(
        [
          '\nNext:',
          '  bun install',
          '  crombolo types new content-type page --name Page --at-root   # a type of page, and its view',
          '  crombolo content new /Home --type page --set title=Home --publish',
          '  bun start',
          '\n`crombolo types --help` and `crombolo content --help` list what else there is.',
        ].join('\n'),
      )
    if (template?.seed)
      this.say(
        '\n`bun start` applies content/ on the first boot, and again after you change it:\n' +
          'the starting content is files to edit. `crombolo site build --check` checks them.',
      )
    return { created, templates: [] }
  }
}
