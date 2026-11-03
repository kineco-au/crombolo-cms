import { addFormField } from '@crombolo/schema'
import { formTypesFor } from '@crombolo/server'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitFormEdit,
  fieldChangesOf,
  fieldFlags,
  findForm,
  formEditFlags,
  formEditSpec,
  groupFlag,
  pageFlag,
  placeFlags,
  settingsOf,
  typeNamed,
} from '../../../support/form-edit.ts'

/** A field added to a form (story 251). */
export default class FormsFieldAdd extends BaseCommand {
  static override summary = 'add a field to a form'
  static override description =
    'It goes at the end of the last fieldset unless --page, --group, --before or --after say where. Its caption comes from its alias unless --caption gives one.'
  static override examples = [
    '<%= config.bin %> forms field add contact message --type longAnswer --mandatory',
    '<%= config.bin %> forms field add contact topic --type dropdown --option Sales --option Support --after email',
    '<%= config.bin %> forms field add contact company --type shortAnswer --show-when topic=Sales',
  ]
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    alias: Args.string({ required: true, description: "the new field's alias" }),
  }
  static override flags = {
    type: Flags.string({
      summary:
        'its type: short-answer, long-answer, email, number, date, checkbox, dropdown, single-choice, multiple-choice, file-upload, data-consent, hidden, or one a bundle adds',
      helpValue: '<type>',
      required: true,
    }),
    ...fieldFlags,
    page: pageFlag,
    group: groupFlag,
    ...placeFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsFieldAdd)
    const found = await findForm(args.form)
    const { changes, said } = fieldChangesOf({ ...flags, type: undefined }, settingsOf(flags.set))
    const type = typeNamed(flags.type, formTypesFor(found.config).fields.keys()) as string
    const result = addFormField(found.form, args.alias, type, changes, {
      page: flags.page,
      group: flags.group,
      before: flags.before,
      after: flags.after,
    })
    return commitFormEdit(
      this,
      found,
      result,
      [`The form "${found.form.name}" gains the ${type} field ${args.alias}:`, ...said],
      flags,
    )
  }
}
