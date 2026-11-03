import { removeFormWorkflow } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
} from '../../../support/form-edit.ts'

/** A form workflow removed (story 251). */
export default class FormsWorkflowRemove extends BaseCommand {
  static override summary = 'remove a workflow from a form'
  static override examples = ['<%= config.bin %> forms workflow remove contact "Tell the team"']
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    workflow: Args.string({ required: true, description: "the workflow's name" }),
  }
  static override flags = { ...formEditFlags }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsWorkflowRemove)
    const found = await findForm(args.form)
    const result = removeFormWorkflow(found.form, args.workflow)
    return commitFormEdit(
      this,
      found,
      result,
      [`The workflow "${args.workflow}" is removed from "${found.form.name}".`],
      flags,
    )
  }
}
