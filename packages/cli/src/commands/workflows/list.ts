import { BaseCommand } from '../../base.ts'
import { openRequests, siteWorkflows } from '../../support/workflows.ts'

/** The site's approval workflows (story 251). */
export default class WorkflowsList extends BaseCommand {
  static override summary = "the site's approval workflows"
  static override examples = ['<%= config.bin %> workflows list']
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'alias', type: 'string' },
            { name: 'name', type: 'string' },
            { name: 'contentTypes', type: 'array', items: { type: 'string' } },
            { name: 'branches', type: 'array', items: { type: 'string' } },
            { name: 'stages', type: 'integer' },
            { name: 'waiting', type: 'integer', nullable: true },
          ],
        },
      },
    ],
  } as const

  async run() {
    const { config, workflows } = await siteWorkflows()
    const items = []
    for (const workflow of workflows) {
      const waiting = (await openRequests(config, workflow)) ?? null
      items.push({
        alias: workflow.alias,
        name: workflow.name,
        contentTypes: workflow.appliesTo.contentTypes,
        branches: workflow.appliesTo.branches,
        stages: workflow.stages.length,
        waiting,
      })
      const covers =
        [...workflow.appliesTo.contentTypes, ...workflow.appliesTo.branches].join(', ') ||
        'nothing yet'
      this.say(
        `  ${workflow.alias.padEnd(24)} ${workflow.name.padEnd(28)} ${workflow.stages.length} stage(s), for ${covers}${waiting ? `, ${waiting} waiting` : ''}`,
      )
    }
    if (items.length === 0) this.say('No approval workflows. `crombolo workflows new` adds one.')
    return { items }
  }
}
