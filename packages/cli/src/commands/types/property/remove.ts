import { removeProperty } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

/** A property taken off a type (story 248): retired, its values kept until `types purge`. */
export default class TypesPropertyRemove extends BaseCommand {
  static override summary = 'remove a property from a type; its values are kept until `types purge`'
  static override examples = ['<%= config.bin %> types property remove article subtitle']
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    property: Args.string({ required: true, description: "the property's alias" }),
  }
  static override flags = { ...editFlags }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesPropertyRemove)
    const found = await findType(args.type, flags.kind)
    return commitTypeEdit(
      this,
      found,
      removeProperty(found.type, args.property),
      [
        `"${args.property}" comes off "${found.type.name}". Its values are kept, and \`crombolo types purge\` deletes them once you are sure.`,
      ],
      flags,
    )
  }
}
