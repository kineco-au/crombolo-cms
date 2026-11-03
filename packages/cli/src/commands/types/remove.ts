import { usesOf } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { CliError } from '../../errors.ts'
import {
  commitDataTypeEdit,
  commitTypeEdit,
  editFlags,
  editSpec,
  findDataType,
  findType,
  KIND_NOUNS,
  TYPE_KINDS,
} from '../../support/type-edit.ts'
import { loadTypes } from '../../support/types.ts'
import { isDataType } from './update.ts'

/** A type or data type taken out of the site (stories 248, 249); refused while something uses it. */
export default class TypesRemove extends BaseCommand {
  static override summary = 'remove a type or data type the site no longer needs'
  static override description = [
    'A type is refused while items of it exist, saying how many: --retire retires it anyway, nothing is deleted, its items keep their values, and the type can come back.',
    'A data type is refused while a property uses it, naming them. Either is refused while another type, block list or picker uses it: `crombolo types show <alias>` says what does.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types remove oldBanner',
    '<%= config.bin %> types remove event --retire',
    '<%= config.bin %> types remove shortText',
  ]
  static override args = {
    alias: Args.string({ required: true, description: "the type's or data type's alias" }),
  }
  static override flags = {
    retire: Flags.boolean({
      summary: 'types: retire it though items use it; they stay, with their values',
    }),
    ...editFlags,
    kind: Flags.string({
      summary: 'the kind, when two share the alias',
      options: [...TYPE_KINDS, 'data'],
    }),
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesRemove)
    if (await isDataType(args.alias, flags.kind)) {
      if (flags.retire)
        throw new CliError('usage', '--retire is for types; a data type has no items of its own.')
      const found = await findDataType(args.alias)
      const using = usesOf(loadTypes(found.config).set, found.dataType.alias).filter(
        (u) => u.property,
      )
      if (using.length > 0)
        throw new CliError('refused', `"${found.dataType.alias}" is used, so it was not removed.`, {
          hint: 'Give those properties another data type with `crombolo types property update <type> <property> --type <data type>` first.',
          details: using.map((u) => `${u.by}.${u.property}`),
        })
      return commitDataTypeEdit(
        this,
        found,
        null,
        [`The data type "${found.dataType.name}" (${found.dataType.alias}) is removed.`],
        flags,
      )
    }
    const found = await findType(args.alias, flags.kind)
    const noun = KIND_NOUNS[found.described]
    return commitTypeEdit(
      this,
      found,
      { ok: true, type: null },
      [
        `The ${noun} "${found.type.name}" (${found.type.alias}) is removed${flags.retire ? ', and retired with its items kept' : ''}.`,
      ],
      flags,
    )
  }
}
