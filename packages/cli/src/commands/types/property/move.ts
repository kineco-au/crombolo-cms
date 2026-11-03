import { moveProperty } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

/** A property moved to another tab, or beside another property (story 248). */
export default class TypesPropertyMove extends BaseCommand {
  static override summary = 'move a property to another tab, or before or after another property'
  static override examples = [
    '<%= config.bin %> types property move article summary --tab Content --before body',
  ]
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    property: Args.string({ required: true, description: "the property's alias" }),
  }
  static override flags = {
    tab: Flags.string({ summary: 'the tab it goes in', helpValue: '<tab>' }),
    before: Flags.string({
      summary: 'the property it goes before',
      helpValue: '<property>',
      exclusive: ['after'],
    }),
    after: Flags.string({ summary: 'the property it goes after', helpValue: '<property>' }),
    ...editFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesPropertyMove)
    const found = await findType(args.type, flags.kind)
    const result = moveProperty(found.type, args.property, {
      tab: flags.tab,
      before: flags.before,
      after: flags.after,
    })
    const where = [
      flags.tab ? `to the tab "${flags.tab}"` : '',
      flags.before ? `before "${flags.before}"` : flags.after ? `after "${flags.after}"` : '',
    ]
      .filter(Boolean)
      .join(', ')
    return commitTypeEdit(
      this,
      found,
      result,
      [`"${args.property}" on "${found.type.name}" moves ${where}.`],
      flags,
    )
  }
}
