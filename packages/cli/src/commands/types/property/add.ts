import { addProperty } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import {
  commitTypeEdit,
  editFlags,
  editSpec,
  findType,
  KIND_NOUNS,
} from '../../../support/type-edit.ts'

/** A property added to a type, in a tab (story 248; `types add-property` before it). */
export default class TypesPropertyAdd extends BaseCommand {
  static override summary = 'add a property to a type'
  static override description =
    'It goes at the end of the tab named, or of the first tab; a tab that does not exist yet is added. Checked against the site first, then applied, unless --no-apply.'
  static override examples = [
    '<%= config.bin %> types property add article summary --type textarea --mandatory',
    '<%= config.bin %> types property add article heroImage --type imageMediaPicker --tab Media',
  ]
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    alias: Args.string({ required: true, description: "the property's alias" }),
  }
  static override flags = {
    type: Flags.string({ summary: 'its data type', helpValue: '<data type>', required: true }),
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    description: Flags.string({ summary: 'its description', helpValue: '<text>' }),
    mandatory: Flags.boolean({ summary: 'an editor must fill it in' }),
    tab: Flags.string({ summary: 'the tab it goes in', helpValue: '<tab>' }),
    ...editFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesPropertyAdd)
    const found = await findType(args.type, flags.kind)
    const result = addProperty(found.type, {
      alias: args.alias,
      type: flags.type,
      name: flags.name,
      description: flags.description,
      mandatory: flags.mandatory,
      tab: flags.tab,
    })
    const where = result.ok ? ` in the tab "${result.tab}"` : ''
    return commitTypeEdit(
      this,
      found,
      result,
      [
        `The ${KIND_NOUNS[found.described]} "${found.type.name}" gains "${args.alias}" (${flags.type}${flags.mandatory ? ', mandatory' : ''})${where}.`,
      ],
      flags,
    )
  }
}
