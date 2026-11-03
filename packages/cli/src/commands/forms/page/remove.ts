import { removeFormPage } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
} from '../../../support/form-edit.ts'

/** A form page removed (story 251); refused while it holds fields, unless they move to another page. */
export default class FormsPageRemove extends BaseCommand {
  static override summary = 'remove a page from a form'
  static override description =
    'Refused while it holds fields, unless --move-fields-to names a page to take them. A form keeps at least one page.'
  static override examples = ['<%= config.bin %> forms page remove contact 2 --move-fields-to 1']
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    page: Args.string({
      required: true,
      description: 'the page, by its caption or its number from 1',
    }),
  }
  static override flags = {
    'move-fields-to': Flags.string({
      summary: 'the page that takes its fields',
      helpValue: '<page>',
    }),
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsPageRemove)
    const found = await findForm(args.form)
    const result = removeFormPage(found.form, args.page, flags['move-fields-to'])
    return commitFormEdit(
      this,
      found,
      result,
      [
        `Page ${args.page} is removed from "${found.form.name}"${flags['move-fields-to'] ? `; its fields move to page ${flags['move-fields-to']}` : ''}.`,
      ],
      flags,
    )
  }
}
