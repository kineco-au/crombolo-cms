import { updateFormGroup } from '@crombolo/schema'
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

/** A fieldset's caption, columns or condition (story 251). */
export default class FormsGroupUpdate extends BaseCommand {
  static override summary = "change a fieldset's caption, columns or when it is shown"
  static override description =
    'The fieldset is on the first page unless --page names another. `--caption ""` takes its caption away.'
  static override examples = [
    '<%= config.bin %> forms group update contact 1 --caption "About you" --columns 2',
  ]
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    group: Args.string({
      required: true,
      description: 'the fieldset, by its caption or its number from 1',
    }),
  }
  static override flags = {
    page: Flags.string({
      summary: 'the page it is on, by its caption or its number from 1',
      helpValue: '<page>',
      default: '1',
    }),
    caption: Flags.string({ summary: 'its caption', helpValue: '<text>' }),
    columns: Flags.integer({ summary: 'the columns its fields are laid out in' }),
    ...conditionFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsGroupUpdate)
    const found = await findForm(args.form)
    const condition = conditionOf(flags)
    const result = updateFormGroup(found.form, flags.page, args.group, {
      caption: flags.caption,
      columns: flags.columns,
      condition,
    })
    return commitFormEdit(
      this,
      found,
      result,
      [
        `Fieldset ${args.group} on page ${flags.page} of "${found.form.name}":`,
        ...(flags.caption !== undefined
          ? [flags.caption ? `  captioned "${flags.caption}"` : '  no caption']
          : []),
        ...(flags.columns ? [`  ${flags.columns} column(s)`] : []),
        ...(condition !== undefined ? [`  ${describeCondition(condition)}`] : []),
      ],
      flags,
    )
  }
}
