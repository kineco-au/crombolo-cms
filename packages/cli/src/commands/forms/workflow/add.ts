import { addFormWorkflow } from '@crombolo/schema'
import { formTypesFor } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
  typeNamed,
  workflowFlags,
  workflowSettingsOf,
} from '../../../support/form-edit.ts'

/** A workflow added to a form: what happens to each entry (story 251). */
export default class FormsWorkflowAdd extends BaseCommand {
  static override summary = 'add a workflow to a form: what happens to each entry'
  static override description =
    'sendEmail, sendToUrl and saveAsContent are built in; a bundle may add others. --set stores any setting as given, for a bundle’s workflow as for these.'
  static override examples = [
    '<%= config.bin %> forms workflow add contact --type send-email --name "Tell the team" --to team@example.com --subject "New enquiry"',
    '<%= config.bin %> forms workflow add contact --type sendToUrl --name "To the CRM" --url https://crm.example.com/leads',
  ]
  static override args = { form: Args.string({ required: true, description: "the form's alias" }) }
  static override flags = {
    type: Flags.string({
      summary: 'its type: send-email, send-to-url, save-as-content, or one a bundle adds',
      helpValue: '<type>',
      required: true,
    }),
    name: Flags.string({
      summary: 'its name, which other commands know it by',
      helpValue: '<name>',
      required: true,
    }),
    ...workflowFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsWorkflowAdd)
    const found = await findForm(args.form)
    const { settings, said } = workflowSettingsOf(flags)
    const on = flags.on as 'submit' | 'approve' | undefined
    const type = typeNamed(flags.type, formTypesFor(found.config).workflows.keys()) as string
    const result = addFormWorkflow(found.form, type, flags.name, { on, settings })
    return commitFormEdit(
      this,
      found,
      result,
      [
        `The form "${found.form.name}" gains the ${type} workflow "${flags.name}", run on ${on ?? 'submit'}:`,
        ...said,
      ],
      flags,
    )
  }
}
