import { moveFormField } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
  groupFlag,
  pageFlag,
  placeFlags,
} from '../../../support/form-edit.ts'

/** A form field moved: beside another field, or to the end of a page or fieldset (story 251). */
export default class FormsFieldMove extends BaseCommand {
  static override summary = 'move a form field beside another, or to another page or fieldset'
  static override examples = [
    '<%= config.bin %> forms field move contact message --after email',
    '<%= config.bin %> forms field move contact company --page 2',
  ]
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    alias: Args.string({ required: true, description: "the field's alias" }),
  }
  static override flags = { page: pageFlag, group: groupFlag, ...placeFlags, ...formEditFlags }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsFieldMove)
    if (!flags.page && !flags.group && !flags.before && !flags.after)
      throw new CliError(
        'usage',
        'Say where: --before or --after another field, or --page and --group.',
      )
    const found = await findForm(args.form)
    const result = moveFormField(found.form, args.alias, {
      page: flags.page,
      group: flags.group,
      before: flags.before,
      after: flags.after,
    })
    const where = flags.before
      ? `before ${flags.before}`
      : flags.after
        ? `after ${flags.after}`
        : [flags.page ? `to page ${flags.page}` : '', flags.group ? `fieldset ${flags.group}` : '']
            .filter(Boolean)
            .join(', ')
    return commitFormEdit(
      this,
      found,
      result,
      [`The field ${args.alias} on "${found.form.name}" moves ${where}.`],
      flags,
    )
  }
}
