import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
  formUsage,
} from '../../support/form-edit.ts'

/** A form removed (story 251); refused while a page or a Library form uses it. */
export default class FormsRemove extends BaseCommand {
  static override summary = 'remove a form no page or Library form uses'
  static override description =
    'Refused while a page picks it or a Library form is made from it, saying how many. Its entries are kept.'
  static override examples = ['<%= config.bin %> forms remove oldSurvey']
  static override args = { alias: Args.string({ required: true, description: "the form's alias" }) }
  static override flags = { ...formEditFlags }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsRemove)
    const found = await findForm(args.alias)
    const used = await formUsage(found.config, found.form)
    if (used && (used.pages > 0 || used.libraryForms > 0))
      throw new CliError('refused', `"${found.form.name}" is in use, so it was not removed.`, {
        details: [
          `${used.pages} page(s) pick it`,
          `${used.libraryForms} Library form(s) are made from it`,
        ],
        hint: 'Pick another form on those pages, and remove its Library forms, first.',
      })
    return commitFormEdit(
      this,
      found,
      { ok: true, form: null },
      [`The form "${found.form.name}" (${found.form.alias}) is removed; its entries are kept.`],
      flags,
    )
  }
}
