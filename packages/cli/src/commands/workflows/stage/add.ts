import { addStage } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { editSpec } from '../../../support/type-edit.ts'
import {
  commitWorkflowEdit,
  findWorkflow,
  refuseUnknownApprovers,
  requirementOf,
  workflowEditFlags,
  writtenWorkflow,
} from '../../../support/workflows.ts'

/** A stage added to an approval workflow (story 251). */
export default class WorkflowsStageAdd extends BaseCommand {
  static override summary = 'add a stage to an approval workflow'
  static override description =
    'It follows the last stages unless --after names others, and is a last stage unless --next names what follows it.'
  static override examples = [
    '<%= config.bin %> workflows stage add article-sign-off legal --approver legal --required all',
  ]
  static override args = {
    workflow: Args.string({ required: true, description: "the workflow's alias" }),
    stage: Args.string({ required: true, description: "the stage's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    approver: Flags.string({
      summary: 'a user group who approve it',
      helpValue: '<group>',
      multiple: true,
      required: true,
    }),
    required: Flags.string({
      summary: 'how many must approve: one, majority, all, or a number',
      helpValue: '<n>',
    }),
    after: Flags.string({ summary: 'a stage it follows', helpValue: '<stage>', multiple: true }),
    next: Flags.string({
      summary: 'a stage that follows it',
      helpValue: '<stage>',
      multiple: true,
    }),
    'send-back': Flags.string({
      summary: 'where it sends back to: editor, or a stage before it',
      helpValue: '<stage|editor>',
    }),
    ...workflowEditFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(WorkflowsStageAdd)
    const found = await findWorkflow(args.workflow)
    const result = addStage(found.workflow, {
      alias: args.stage,
      name: flags.name,
      approvers: flags.approver,
      required: requirementOf(flags.required),
      after: flags.after,
      next: flags.next,
      sendBack: flags['send-back'],
    })
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    await refuseUnknownApprovers(found.config, result.workflow)
    return commitWorkflowEdit(
      this,
      {
        config: found.config,
        alias: found.workflow.alias,
        file: found.file,
        current: writtenWorkflow(found.workflow),
        next: writtenWorkflow(result.workflow),
      },
      [
        `"${found.workflow.name}" gains the stage "${args.stage}", approved by ${flags.approver.join(', ')}.`,
      ],
      flags,
    )
  }
}
