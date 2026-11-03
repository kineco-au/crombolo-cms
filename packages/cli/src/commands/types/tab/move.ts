import { moveTab } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

/** A tab moved before or after another (story 248). */
export default class TypesTabMove extends BaseCommand {
  static override summary = 'move a tab before or after another'
  static override examples = ['<%= config.bin %> types tab move article SEO --before Content']
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    name: Args.string({ required: true, description: "the tab's name" }),
  }
  static override flags = {
    before: Flags.string({
      summary: 'the tab it goes before',
      helpValue: '<tab>',
      exclusive: ['after'],
    }),
    after: Flags.string({ summary: 'the tab it goes after', helpValue: '<tab>' }),
    ...editFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesTabMove)
    const found = await findType(args.type, flags.kind)
    const where = flags.before ? `before "${flags.before}"` : `after "${flags.after}"`
    return commitTypeEdit(
      this,
      found,
      moveTab(found.type, args.name, { before: flags.before, after: flags.after }),
      [`The tab "${args.name}" on "${found.type.name}" moves ${where}.`],
      flags,
    )
  }
}
