import { removeFormGroup } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  findForm,
  formEditFlags,
  formEditSpec,
} from '../../../support/form-edit.ts'

/** A fieldset removed (story 251); refused while it holds fields, unless they move to another. */
export default class FormsGroupRemove extends BaseCommand {
  static override summary = 'remove a fieldset from a page of a form'
  static override description =
    'Refused while it holds fields, unless --move-fields-to names a fieldset on the same page to take them. A page keeps at least one fieldset.'
  static override examples = ['<%= config.bin %> forms group remove contact 2 --move-fields-to 1']
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
    'move-fields-to': Flags.string({
      summary: 'the fieldset that takes its fields',
      helpValue: '<fieldset>',
    }),
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsGroupRemove)
    const found = await findForm(args.form)
    const result = removeFormGroup(found.form, flags.page, args.group, flags['move-fields-to'])
    return commitFormEdit(
      this,
      found,
      result,
      [
        `Fieldset ${args.group} is removed from page ${flags.page} of "${found.form.name}"${flags['move-fields-to'] ? `; its fields move to fieldset ${flags['move-fields-to']}` : ''}.`,
      ],
      flags,
    )
  }
}
