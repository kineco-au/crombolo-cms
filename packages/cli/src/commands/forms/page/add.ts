import { addFormPage } from '@crombolo/schema'
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

/** A page added to a form, with one empty fieldset (story 251). */
export default class FormsPageAdd extends BaseCommand {
  static override summary = 'add a page to a form, with one empty fieldset'
  static override description =
    'At the end, unless --before or --after names a page by its caption or its number from 1.'
  static override examples = [
    '<%= config.bin %> forms page add contact --caption "About you" --after 1',
  ]
  static override args = { form: Args.string({ required: true, description: "the form's alias" }) }
  static override flags = {
    caption: Flags.string({ summary: 'its caption', helpValue: '<text>' }),
    ...conditionFlags,
    ...placeFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsPageAdd)
    const found = await findForm(args.form)
    const condition = conditionOf(flags)
    const result = addFormPage(
      found.form,
      { caption: flags.caption, condition },
      { before: flags.before, after: flags.after },
    )
    return commitFormEdit(
      this,
      found,
      result,
      [
        `The form "${found.form.name}" gains a page${flags.caption ? ` "${flags.caption}"` : ''}${condition ? `, ${describeCondition(condition)}` : ''}.`,
      ],
      flags,
    )
  }
}
