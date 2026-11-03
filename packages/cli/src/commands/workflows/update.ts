import {
  WORKFLOW_COMMENTS,
  WORKFLOW_ON_CHANGE,
  WORKFLOW_ON_EDIT,
  WORKFLOW_SELF_APPROVAL,
} from '@crombolo/core'
import { updateWorkflow } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import { editSpec } from '../../support/type-edit.ts'
import {
  commitWorkflowEdit,
  findWorkflow,
  refuseUnknownApprovers,
  workflowEditFlags,
  writtenWorkflow,
} from '../../support/workflows.ts'

const many = (summary: string, helpValue: string) =>
  Flags.string({ summary, helpValue, multiple: true })
const yesNo = (summary: string) => Flags.boolean({ summary, allowNo: true })

/** An approval workflow's name, rules and what it covers (story 251). */
export default class WorkflowsUpdate extends BaseCommand {
  static override summary = "change an approval workflow's name, rules or what it covers"
  static override description =
    'Checked against the site first, then applied, unless --no-apply. What requests already waiting do follows its --on-change rule.'
  static override examples = [
    '<%= config.bin %> workflows update article-sign-off --content-type news --self-approval refused',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the workflow's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    'content-type': many('cover this content type too', '<type>'),
    'remove-content-type': many('stop covering this content type', '<type>'),
    branch: many('cover this branch too', '<branch>'),
    'remove-branch': many('stop covering this branch', '<branch>'),
    'publishers-may-skip': yesNo('people who may publish skip it'),
    'on-edit': Flags.string({
      summary: 'what saving a page does while it waits',
      options: [...WORKFLOW_ON_EDIT],
    }),
    'self-approval': Flags.string({
      summary: 'whether whoever sent it may approve it',
      options: [...WORKFLOW_SELF_APPROVAL],
    }),
    comments: Flags.string({
      summary: 'when a decision needs a comment',
      options: [...WORKFLOW_COMMENTS],
    }),
    unpublish: yesNo('taking a page down goes through it too'),
    'on-change': Flags.string({
      summary: 'what waiting requests do when it changes',
      options: [...WORKFLOW_ON_CHANGE],
    }),
    scheduling: yesNo('a request may say when to publish or take down'),
    ...workflowEditFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(WorkflowsUpdate)
    const found = await findWorkflow(args.alias)
    const result = updateWorkflow(found.workflow, {
      name: flags.name,
      addContentTypes: flags['content-type'],
      removeContentTypes: flags['remove-content-type'],
      addBranches: flags.branch,
      removeBranches: flags['remove-branch'],
      publishersMaySkip: flags['publishers-may-skip'],
      onEdit: flags['on-edit'] as never,
      selfApproval: flags['self-approval'] as never,
      comments: flags.comments as never,
      unpublish: flags.unpublish,
      onChange: flags['on-change'] as never,
      scheduling: flags.scheduling,
    })
    if (!result.ok) throw new CliError('refused', `Nothing was changed: ${result.reason}.`)
    await refuseUnknownApprovers(found.config, result.workflow)
    const named = Object.entries(flags)
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
      [`The approval workflow "${found.workflow.name}" (${found.workflow.alias}):`, ...named],
      flags,
    )
  }
}
