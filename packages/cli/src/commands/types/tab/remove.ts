import { removeTab } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

/** A tab removed, its properties moved to another or the command refused (story 248). */
export default class TypesTabRemove extends BaseCommand {
  static override summary = "remove a type's tab, moving its properties to another"
  static override description =
    'Refused while the tab holds properties, unless --move-to names the tab they go to.'
  static override examples = ['<%= config.bin %> types tab remove article Extras --move-to Content']
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    name: Args.string({ required: true, description: "the tab's name" }),
  }
  static override flags = {
    'move-to': Flags.string({ summary: 'the tab its properties go to', helpValue: '<tab>' }),
    ...editFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesTabRemove)
    const found = await findType(args.type, flags.kind)
    return commitTypeEdit(
      this,
      found,
      removeTab(found.type, args.name, flags['move-to']),
      [
        `The tab "${args.name}" comes off "${found.type.name}"${flags['move-to'] ? `, its properties moving to "${flags['move-to']}"` : ''}.`,
      ],
      flags,
    )
  }
}
