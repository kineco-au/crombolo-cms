import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileNameFor, newForm, writeForm } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeSync, here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'
import { applySchema, loadTypes, needSchemaDir, refuseOwnProblems } from '../../support/types.ts'

export default class FormsNew extends BaseCommand {
  static override summary = 'write a form asking for a name and an email address, then apply it'
  static override examples = ['<%= config.bin %> forms new contact --name "Get in touch"']
  static override args = {
    alias: Args.string({ required: true, description: "the form's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: "the form's name", helpValue: '<name>' }),
  }
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'created', type: 'array', items: { type: 'string' } },
      { name: 'schema', type: 'string' },
    ],
    errors: ['not_found', 'conflict', 'refused'],
  } as const

  async run() {
    const { args, flags } = await this.parse(FormsNew)
    const config = await siteConfig()
    needSchemaDir(config)
    const loaded = loadTypes(config)
    if ((loaded.set.forms ?? []).some((f) => f.alias === args.alias))
      this.fail('conflict', `There is already a form with the alias "${args.alias}".`)
    const form = newForm(args.alias, flags.name)
    refuseOwnProblems(
      { ...loaded.set, forms: [...(loaded.set.forms ?? []), form] },
      `schema/forms/${args.alias}`,
    )
    const file = join(config.schemaDir, 'forms', fileNameFor(args.alias))
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, writeForm(form))
    this.say(`  created  ${here(file)}`)
    const report = await applySchema(this, config)
    return { created: [here(file)], schema: describeSync(report) }
  }
}
