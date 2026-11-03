import { updateFormWorkflow } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
  workflowFlags,
  workflowSettingsOf,
} from '../../../support/form-edit.ts'

/** A form workflow's name, trigger or settings (story 251). */
export default class FormsWorkflowUpdate extends BaseCommand {
  static override summary = "change a form workflow's name, when it runs, or its settings"
  static override description =
    'Settings given are merged over those it has; --unset takes one away.'
  static override examples = [
    '<%= config.bin %> forms workflow update contact "Tell the team" --to sales@example.com --to support@example.com',
    '<%= config.bin %> forms workflow update contact "Tell the team" --unset cc --on approve',
  ]
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    workflow: Args.string({ required: true, description: "the workflow's name" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its new name', helpValue: '<name>' }),
    ...workflowFlags,
    unset: Flags.string({ summary: 'take a setting away', helpValue: '<setting>', multiple: true }),
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsWorkflowUpdate)
    const found = await findForm(args.form)
    const { settings, said } = workflowSettingsOf(flags)
    const on = flags.on as 'submit' | 'approve' | undefined
    const result = updateFormWorkflow(found.form, args.workflow, {
      name: flags.name,
      on,
      settings,
      unset: flags.unset,
    })
    return commitFormEdit(
      this,
      found,
      result,
      [
        `The workflow "${args.workflow}" on "${found.form.name}":`,
        ...(flags.name ? [`  named "${flags.name}"`] : []),
        ...(on ? [`  runs on ${on}`] : []),
        ...said,
        ...(flags.unset ?? []).map((key) => `  no ${key}`),
      ],
      flags,
    )
  }
}
