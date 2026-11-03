import { moveFormGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
  placeFlags,
} from '../../../support/form-edit.ts'

/** A fieldset moved beside another on its page (story 251). */
export default class FormsGroupMove extends BaseCommand {
  static override summary = 'move a fieldset before or after another on its page'
  static override examples = [
    '<%= config.bin %> forms group move contact "Your address" --before 1',
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
    ...placeFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsGroupMove)
    const found = await findForm(args.form)
    const result = moveFormGroup(found.form, flags.page, args.group, {
      before: flags.before,
      after: flags.after,
    })
    const where = flags.before ? `before fieldset ${flags.before}` : `after fieldset ${flags.after}`
    return commitFormEdit(
      this,
      found,
      result,
      [`Fieldset ${args.group} on page ${flags.page} of "${found.form.name}" moves ${where}.`],
      flags,
    )
  }
}
