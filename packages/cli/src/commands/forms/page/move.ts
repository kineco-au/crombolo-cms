import { moveFormPage } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
  placeFlags,
} from '../../../support/form-edit.ts'

/** A form page moved beside another (story 251). */
export default class FormsPageMove extends BaseCommand {
  static override summary = 'move a form page before or after another'
  static override examples = ['<%= config.bin %> forms page move contact "About you" --before 1']
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    page: Args.string({
      required: true,
      description: 'the page, by its caption or its number from 1',
    }),
  }
  static override flags = { ...placeFlags, ...formEditFlags }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsPageMove)
    const found = await findForm(args.form)
    const result = moveFormPage(found.form, args.page, { before: flags.before, after: flags.after })
    const where = flags.before ? `before page ${flags.before}` : `after page ${flags.after}`
    return commitFormEdit(
      this,
      found,
      result,
      [`Page ${args.page} of "${found.form.name}" moves ${where}.`],
      flags,
    )
  }
}
