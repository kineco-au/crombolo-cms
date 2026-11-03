import { removeFormField } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
} from '../../../support/form-edit.ts'

/** A form field removed (story 251); refused while a condition names it. */
export default class FormsFieldRemove extends BaseCommand {
  static override summary = 'remove a field from a form'
  static override description =
    'Refused while another field, page or fieldset is shown depending on it. Answers already sent keep it.'
  static override examples = ['<%= config.bin %> forms field remove contact company']
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    alias: Args.string({ required: true, description: "the field's alias" }),
  }
  static override flags = { ...formEditFlags }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsFieldRemove)
    const found = await findForm(args.form)
    const result = removeFormField(found.form, args.alias)
    return commitFormEdit(
      this,
      found,
      result,
      [`The field ${args.alias} is removed from "${found.form.name}".`],
      flags,
    )
  }
}
