import { updateFormPage } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  conditionFlags,
  conditionOf,
  describeCondition,
  findForm,
  formEditFlags,
  formEditSpec,
} from '../../../support/form-edit.ts'

/** A form page's caption or condition (story 251). */
export default class FormsPageUpdate extends BaseCommand {
  static override summary = "change a form page's caption or when it is shown"
  static override description =
    '`--caption ""` takes its caption away; --show-always its condition.'
  static override examples = [
    '<%= config.bin %> forms page update contact 2 --caption "Your company" --show-when topic=Sales',
  ]
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    page: Args.string({
      required: true,
      description: 'the page, by its caption or its number from 1',
    }),
  }
  static override flags = {
    caption: Flags.string({ summary: 'its caption', helpValue: '<text>' }),
    ...conditionFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsPageUpdate)
    const found = await findForm(args.form)
    const condition = conditionOf(flags)
    const result = updateFormPage(found.form, args.page, { caption: flags.caption, condition })
    return commitFormEdit(
      this,
      found,
      result,
      [
        `Page ${args.page} of "${found.form.name}":`,
        ...(flags.caption !== undefined
          ? [flags.caption ? `  captioned "${flags.caption}"` : '  no caption']
          : []),
        ...(condition !== undefined ? [`  ${describeCondition(condition)}`] : []),
      ],
      flags,
    )
  }
}
