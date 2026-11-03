import { addTab } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

/** A tab added to a type (story 248). */
export default class TypesTabAdd extends BaseCommand {
  static override summary = 'add a tab to a type'
  static override examples = ['<%= config.bin %> types tab add article SEO --after Content']
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
    const { args, flags } = await this.parse(TypesTabAdd)
    const found = await findType(args.type, flags.kind)
    return commitTypeEdit(
      this,
      found,
      addTab(found.type, args.name, { before: flags.before, after: flags.after }),
      [`"${found.type.name}" gains the tab "${args.name}".`],
      flags,
    )
  }
}
