import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { editSpec } from '../../support/type-edit.ts'
import {
  commitWorkflowEdit,
  findWorkflow,
  openRequests,
  workflowEditFlags,
  writtenWorkflow,
} from '../../support/workflows.ts'

/** An approval workflow removed (story 251): the requests waiting on it are withdrawn, as the back office does. */
export default class WorkflowsRemove extends BaseCommand {
  static override summary = 'remove an approval workflow; the requests waiting on it are withdrawn'
  static override examples = ['<%= config.bin %> workflows remove article-sign-off --dry-run']
  static override args = {
    alias: Args.string({ required: true, description: "the workflow's alias" }),
  }
  static override flags = { ...workflowEditFlags }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(WorkflowsRemove)
    const found = await findWorkflow(args.alias)
    const waiting = (await openRequests(found.config, found.workflow)) ?? 0
    return commitWorkflowEdit(
      this,
      {
        config: found.config,
        alias: found.workflow.alias,
        file: found.file,
        current: writtenWorkflow(found.workflow),
        next: null,
      },
      [
        `The approval workflow "${found.workflow.name}" (${found.workflow.alias}) is removed${waiting > 0 ? `, and the ${waiting} request(s) waiting on it are withdrawn` : ''}.`,
      ],
      flags,
    )
  }
}
