import { renameDataType, renameType } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { commitRename, renameFlags, renameSpec } from '../../support/rename.ts'
import {
  editFlags,
  findDataType,
  findType,
  KIND_NOUNS,
  TYPE_KINDS,
} from '../../support/type-edit.ts'
import { isDataType } from './update.ts'

/** A type's or a data type's alias changed, its content kept (story 250). */
export default class TypesRename extends BaseCommand {
  static override summary = "rename a type's or a data type's alias, keeping its content"
  static override description = [
    'The type keeps everything made of it: only the alias it is known by changes.',
    'Refused while anything else names the old alias, listing each: other definitions, content files and views. --everywhere renames it in all of them as one step, and is refused when one of them cannot be changed safely.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types rename newsItem article',
    '<%= config.bin %> types rename newsItem article --everywhere',
    '<%= config.bin %> types rename shortText headline --kind data',
  ]
  static override args = {
    alias: Args.string({ required: true, description: 'its alias now' }),
    to: Args.string({ required: true, description: 'its new alias' }),
  }
  static override flags = {
    ...editFlags,
    ...renameFlags,
    kind: Flags.string({
      summary: 'the kind, when two share the alias',
      options: [...TYPE_KINDS, 'data'],
    }),
  }
  static override spec = renameSpec

  async run() {
    const { args, flags } = await this.parse(TypesRename)
    if (await isDataType(args.alias, flags.kind)) {
      const found = await findDataType(args.alias)
      const from = found.dataType.alias
      return commitRename(
        this,
        found.config,
        { what: 'data', from, to: args.to },
        (set) => renameDataType(set, from, args.to),
        `The data type "${found.dataType.name}" (${from}) is renamed "${args.to}".`,
        flags,
      )
    }
    const found = await findType(args.alias, flags.kind)
    const from = found.type.alias
    return commitRename(
      this,
      found.config,
      { what: 'type', kind: found.kind, from, to: args.to },
      (set) => renameType(set, found.kind, from, args.to),
      `The ${KIND_NOUNS[found.described]} "${found.type.name}" (${from}) is renamed "${args.to}", keeping its content.`,
      flags,
    )
  }
}
