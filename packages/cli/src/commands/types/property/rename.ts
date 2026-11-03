import { allProperties, renameProperty } from '@crombolo/schema'
import { Args } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { CliError } from '../../../errors.ts'
import { commitRename, renameFlags, renameSpec } from '../../../support/rename.ts'
import { editFlags, findType } from '../../../support/type-edit.ts'

/** A property's alias changed, its values kept (story 250). */
export default class TypesPropertyRename extends BaseCommand {
  static override summary = "rename a property's alias, keeping its values"
  static override description = [
    'The property keeps its values: only the alias it is known by changes.',
    'Refused while anything else names the old alias, listing each: other definitions, content files and views. --everywhere renames it in all of them as one step, and is refused when one of them cannot be changed safely.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types property rename article subtitle standfirst',
    '<%= config.bin %> types property rename article subtitle standfirst --everywhere',
  ]
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    property: Args.string({ required: true, description: "the property's alias now" }),
    to: Args.string({ required: true, description: 'its new alias' }),
  }
  static override flags = { ...editFlags, ...renameFlags }
  static override spec = renameSpec

  async run() {
    const { args, flags } = await this.parse(TypesPropertyRename)
    const found = await findType(args.type, flags.kind)
    const property = allProperties(found.type).find(
      (p) => p.alias.toLowerCase() === args.property.toLowerCase(),
    )
    if (!property)
      throw new CliError('not_found', `"${found.type.alias}" has no property "${args.property}".`, {
        hint: `\`crombolo types show ${found.type.alias}\` lists its properties.`,
      })
    const type = found.type.alias
    return commitRename(
      this,
      found.config,
      { what: 'property', kind: found.kind, type, from: property.alias, to: args.to },
      (set) => renameProperty(set, found.kind, type, property.alias, args.to),
      `"${property.alias}" on "${found.type.name}" is renamed "${args.to}", keeping its values.`,
      flags,
    )
  }
}
