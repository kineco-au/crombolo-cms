import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { findWorkflow, openRequests } from '../../support/workflows.ts'

/** One approval workflow: its rules and its stages (story 251). */
export default class WorkflowsShow extends BaseCommand {
  static override summary = 'one approval workflow: what it covers, its rules and its stages'
  static override examples = ['<%= config.bin %> workflows show article-sign-off']
  static override args = {
    alias: Args.string({ required: true, description: "the workflow's alias" }),
  }
  static override spec = { effects: 'read_only', cardinality: 'single', stdoutSchema: {} } as const

  async run() {
    const { args } = await this.parse(WorkflowsShow)
    const { config, workflow } = await findWorkflow(args.alias)
    const waiting = (await openRequests(config, workflow)) ?? null
    this.say(`Approval workflow "${workflow.name}" (${workflow.alias})`)
    this.say(`  content types  ${workflow.appliesTo.contentTypes.join(', ') || 'none'}`)
    this.say(`  branches       ${workflow.appliesTo.branches.join(', ') || 'none'}`)
    this.say(
      `  on edit ${workflow.onEdit} · self-approval ${workflow.selfApproval} · comments ${workflow.comments} · on change ${workflow.onChange}`,
    )
    this.say(
      `  ${workflow.publishersMaySkip ? 'publishers may skip it' : 'publishers go through it'} · ${workflow.unpublish ? 'covers unpublishing' : 'not for unpublishing'}${workflow.scheduling ? ' · scheduling' : ''}`,
    )
    if (waiting !== null) this.say(`  waiting        ${waiting} request(s)`)
    this.say('\n  Stages')
    for (const stage of workflow.stages)
      this.say(
        `    ${stage.alias.padEnd(20)} ${(stage.name ?? '').padEnd(20)} ${stage.approvers.join(', ')} (${stage.required}) → ${stage.next.join(', ') || 'publish'}; sends back to ${stage.sendBack}`,
      )
    this.say('\n`crombolo workflows update`, and `workflows stage add|update|remove`, change it.')
    return { ...workflow, waiting }
  }
}
