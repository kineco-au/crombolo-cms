import { updateStage } from '@crombolo/schema'
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

/** A stage's name, approvers, what it needs, what follows it and where it sends back (story 251). */
export default class WorkflowsStageUpdate extends BaseCommand {
  static override summary = "change an approval workflow's stage"
  static override description =
    '--approver gives every approver group; --add-approver and --remove-approver change one. --next gives everything that follows it; `--next none` makes it a last stage.'
  static override examples = [
    '<%= config.bin %> workflows stage update article-sign-off review --add-approver editor --required majority',
  ]
  static override args = {
    workflow: Args.string({ required: true, description: "the workflow's alias" }),
    stage: Args.string({ required: true, description: "the stage's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name; "" for none', helpValue: '<name>' }),
    approver: Flags.string({
      summary: 'every user group who approve it',
      helpValue: '<group>',
      multiple: true,
    }),
    'add-approver': Flags.string({
      summary: 'a user group who approve it too',
      helpValue: '<group>',
      multiple: true,
    }),
    'remove-approver': Flags.string({
      summary: 'a user group who no longer approve it',
      helpValue: '<group>',
      multiple: true,
    }),
    required: Flags.string({
      summary: 'how many must approve: one, majority, all, or a number',
      helpValue: '<n>',
    }),
    next: Flags.string({
      summary: 'every stage that follows it; none for a last stage',
      helpValue: '<stage|none>',
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
    const { args, flags } = await this.parse(WorkflowsStageUpdate)
    const found = await findWorkflow(args.workflow)
    const next = flags.next === undefined ? undefined : flags.next.filter((s) => s !== 'none')
    const result = updateStage(found.workflow, args.stage, {
      name: flags.name,
      approvers: flags.approver,
      addApprovers: flags['add-approver'],
      removeApprovers: flags['remove-approver'],
      required: requirementOf(flags.required),
      next,
      sendBack: flags['send-back'],
    })
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    await refuseUnknownApprovers(found.config, result.workflow)
    const said = Object.entries(flags)
      .filter(
        ([flag, value]) =>
          value !== undefined && !['kind', 'dry-run', 'no-apply', 'json'].includes(flag),
      )
      .map(
        ([flag, value]) => `  ${flag} ${Array.isArray(value) ? value.join(', ') : String(value)}`,
      )
    return commitWorkflowEdit(
      this,
      {
        config: found.config,
        alias: found.workflow.alias,
        file: found.file,
        current: writtenWorkflow(found.workflow),
        next: writtenWorkflow(result.workflow),
      },
      [`The stage "${args.stage}" of "${found.workflow.name}":`, ...said],
      flags,
    )
  }
}
