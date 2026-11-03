import { updateFormField } from '@crombolo/schema'
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
  settingsOf,
  typeNamed,
} from '../../../support/form-edit.ts'

/** A form field's settings (story 251). */
export default class FormsFieldUpdate extends BaseCommand {
  static override summary = "change a form field's caption, type, rules, choices or condition"
  static override description =
    '--option replaces the choices with those given. `--help ""` and `--pattern ""` take one away; --show-always takes its condition away.'
  static override examples = [
    '<%= config.bin %> forms field update contact message --caption "Your message" --no-mandatory',
    '<%= config.bin %> forms field update contact company --show-always',
  ]
  static override args = {
    form: Args.string({ required: true, description: "the form's alias" }),
    alias: Args.string({ required: true, description: "the field's alias" }),
  }
  static override flags = {
    type: Flags.string({ summary: 'its type', helpValue: '<type>' }),
    ...fieldFlags,
    ...formEditFlags,
  }
  static override spec = formEditSpec

  async run() {
    const { args, flags } = await this.parse(FormsFieldUpdate)
    const found = await findForm(args.form)
    const type = typeNamed(flags.type, formTypesFor(found.config).fields.keys())
    const { changes, said } = fieldChangesOf({ ...flags, type }, settingsOf(flags.set))
    const result = updateFormField(found.form, args.alias, changes)
    return commitFormEdit(
      this,
      found,
      result,
      [`The field ${args.alias} on "${found.form.name}":`, ...said],
      flags,
    )
  }
}
