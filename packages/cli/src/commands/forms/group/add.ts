import { addFormGroup } from '@crombolo/schema'
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
  placeFlags,
} from '../../../support/form-edit.ts'

/** A fieldset added to a form page (story 251). */
export default class FormsGroupAdd extends BaseCommand {
  static override summary = 'add a fieldset to a page of a form'
  static override description =
    'On the last page unless --page names one, at its end unless --before or --after names a fieldset.'
  static override examples = [
    '<%= config.bin %> forms group add contact --caption "Your address" --columns 2',
  ]
  static override args = { form: Args.string({ required: true, description: "the form's alias" }) }
  static override flags = {
    page: Flags.string({
      summary: 'the page, by its caption or its number from 1',
      helpValue: '<page>',
    }),
    caption: Flags.string({ summary: 'its caption', helpValue: '<text>' }),
    columns: Flags.integer({ summary: 'the columns its fields are laid out in', min: 1 }),
    ...conditionFlags,
    ...placeFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsGroupAdd)
    const found = await findForm(args.form)
    const condition = conditionOf(flags)
    const page = flags.page ?? String(found.form.pages.length)
    const result = addFormGroup(
      found.form,
      page,
      { caption: flags.caption, columns: flags.columns, condition },
      { before: flags.before, after: flags.after },
    )
    return commitFormEdit(
      this,
      found,
      result,
      [
        `Page ${page} of "${found.form.name}" gains a fieldset${flags.caption ? ` "${flags.caption}"` : ''}${flags.columns ? ` in ${flags.columns} columns` : ''}${condition ? `, ${describeCondition(condition)}` : ''}.`,
      ],
      flags,
    )
  }
}
