import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { cwd } from '../support/site.ts'
import { findTemplate, listTemplates, scaffoldFiles } from '../templates.ts'

export default class Init extends BaseCommand {
  static override summary = 'scaffold a site in the current directory'
  static override description =
    'A --template brings schema, views and content; `--template list` prints the templates.'
  static override examples = ['<%= config.bin %> init', '<%= config.bin %> init --template list']
  static override flags = {
    force: Flags.boolean({ summary: 'overwrite files that are already here' }),
    name: Flags.string({ summary: "the site's name", helpValue: '<site name>' }),
    postgres: Flags.boolean({ summary: 'configure Postgres rather than SQLite' }),
    template: Flags.string({ summary: 'a starter template, or `list`', helpValue: '<id>' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'bounded',
    outputFields: [
      { name: 'created', type: 'array', items: { type: 'string' } },
      { name: 'existing', type: 'array', items: { type: 'string' } },
      { name: 'templates', type: 'array', items: { type: 'object' } },
    ],
    errors: ['not_found'],
  } as const

  async run() {
    const { flags } = await this.parse(Init)
    if (flags.template === 'list') {
      const templates = listTemplates().map((t) => ({ id: t.id, description: t.description }))
      for (const t of templates) this.say(`  ${t.id.padEnd(20)} ${t.description}`)
      this.say('\n  (no --template scaffolds the files and no content)')
      this.changedNothing = true
      return { created: [], existing: [], templates }
    }
    const template = flags.template ? findTemplate(flags.template) : undefined
    if (flags.template && !template)
      this.fail(
        'not_found',
        `No template "${flags.template}".`,
        '`crombolo init --template list` prints them.',
      )

    const created: string[] = []
    const existing: string[] = []
    for (const file of scaffoldFiles({
      siteName: flags.name,
      postgres: flags.postgres,
      template,
    })) {
      const target = join(cwd(), file.path)
      if (existsSync(target) && !flags.force) {
        existing.push(file.path)
        this.say(`  exists   ${file.path}`)
        continue
      }
      await mkdir(join(target, '..'), { recursive: true })
      if (file.copyFrom === undefined) await writeFile(target, file.text ?? '')
      else await Bun.write(target, Bun.file(file.copyFrom))
      created.push(file.path)
      this.say(`  created  ${file.path}`)
    }

    this.say('\nNext:\n  bun install\n  bun start')
    if (template?.seed)
      this.say(
        '\n`bun start` applies seed/ on the first boot, and again after you change it:\n' +
          'the starting content is files to edit. `crombolo seed check` checks them.',
      )
    return { created, existing, templates: [] }
  }
}
