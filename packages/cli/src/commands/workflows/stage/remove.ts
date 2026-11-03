import { removeStage } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { editSpec } from '../../../support/type-edit.ts'
import {
  commitWorkflowEdit,
  findWorkflow,
  workflowEditFlags,
  writtenWorkflow,
} from '../../../support/workflows.ts'

/** A stage taken out of an approval workflow, the stages before it passing on to what followed it (story 251). */
export default class WorkflowsStageRemove extends BaseCommand {
  static override summary = 'remove a stage from an approval workflow'
  static override description =
    'The stages before it pass on to what followed it. Refused while another stage sends back to it, or when it is the only stage.'
  static override examples = ['<%= config.bin %> workflows stage remove article-sign-off legal']
  static override args = {
    workflow: Args.string({ required: true, description: "the workflow's alias" }),
    stage: Args.string({ required: true, description: "the stage's alias" }),
  }
  static override flags = { ...workflowEditFlags }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(WorkflowsStageRemove)
    const found = await findWorkflow(args.workflow)
    const result = removeStage(found.workflow, args.stage)
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    return commitWorkflowEdit(
      this,
      {
        config: found.config,
        alias: found.workflow.alias,
        file: found.file,
        current: writtenWorkflow(found.workflow),
        next: writtenWorkflow(result.workflow),
      },
      [`The stage "${args.stage}" comes out of "${found.workflow.name}".`],
      flags,
    )
  }
}
