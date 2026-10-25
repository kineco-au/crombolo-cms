import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileNameFor, newWorkflow, writeWorkflow } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { describeSync, here } from '../../support/describe.ts'
import { siteConfig } from '../../support/site.ts'
import { applySchema, loadTypes, needSchemaDir, refuseOwnProblems } from '../../support/types.ts'

export default class WorkflowsNew extends BaseCommand {
  static override summary = 'write an approval workflow with one stage, then apply it'
  static override examples = [
    '<%= config.bin %> workflows new article-sign-off --content-type article --approver editor',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the workflow's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: "the workflow's name", helpValue: '<name>' }),
    'content-type': Flags.string({
      summary: 'a content type it covers',
      helpValue: '<alias>',
      multiple: true,
    }),
    approver: Flags.string({
      summary: 'a user group who approve; editors when absent',
      helpValue: '<group>',
      multiple: true,
    }),
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
    const { args, flags } = await this.parse(WorkflowsNew)
    const config = await siteConfig()
    needSchemaDir(config)
    const loaded = loadTypes(config)
    if ((loaded.set.workflows ?? []).some((w) => w.alias === args.alias))
      this.fail('conflict', `There is already a workflow with the alias "${args.alias}".`)
    const workflow = newWorkflow({
      alias: args.alias,
      name: flags.name,
      contentTypes: flags['content-type'],
      approvers: flags.approver,
    })
    refuseOwnProblems(
      { ...loaded.set, workflows: [...(loaded.set.workflows ?? []), workflow] },
      `schema/workflows/${args.alias}`,
    )
    const file = join(config.schemaDir, 'workflows', fileNameFor(args.alias))
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, writeWorkflow(workflow))
    this.say(`  created  ${here(file)}`)
    const report = await applySchema(this, config)
    return { created: [here(file)], schema: describeSync(report) }
  }
}
