import { renameTab } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

/** A tab renamed (story 248). */
export default class TypesTabRename extends BaseCommand {
  static override summary = "rename a type's tab"
  static override examples = ['<%= config.bin %> types tab rename article Content Story']
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    name: Args.string({ required: true, description: "the tab's name" }),
    to: Args.string({ required: true, description: 'its new name' }),
  }
  static override flags = { ...editFlags }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesTabRename)
    const found = await findType(args.type, flags.kind)
    return commitTypeEdit(
      this,
      found,
      renameTab(found.type, args.name, args.to),
      [`The tab "${args.name}" on "${found.type.name}" is now "${args.to}".`],
      flags,
    )
  }
}
