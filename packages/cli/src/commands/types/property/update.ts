import { updateProperty } from '@crombolo/schema'
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { commitTypeEdit, editFlags, editSpec, findType } from '../../../support/type-edit.ts'

const yesNo = (summary: string) => Flags.boolean({ summary, allowNo: true })

/** A property's name, description, validation, variance or data type (story 248). */
export default class TypesPropertyUpdate extends BaseCommand {
  static override summary =
    "change a property's name, description, validation, variance or data type"
  static override description = [
    "A new data type is taken only where the property's stored values convert to it; otherwise it is refused with what the values are. Checked against the site first, then applied, unless --no-apply.",
    'Each --no- form turns a setting off: --no-mandatory, --no-vary-by-culture. `--regex ""` takes the validation away.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> types property update article title --name Headline --mandatory',
    '<%= config.bin %> types property update article summary --type richtext --dry-run',
  ]
  static override args = {
    type: Args.string({ required: true, description: "the type's alias" }),
    property: Args.string({ required: true, description: "the property's alias" }),
  }
  static override flags = {
    name: Flags.string({ summary: 'its name', helpValue: '<name>' }),
    description: Flags.string({ summary: 'its description; "" for none', helpValue: '<text>' }),
    mandatory: yesNo('an editor must fill it in'),
    regex: Flags.string({
      summary: 'what a value must match; "" for nothing',
      helpValue: '<pattern>',
    }),
    'regex-message': Flags.string({
      summary: 'what an editor is told when it does not',
      helpValue: '<text>',
    }),
    'vary-by-culture': yesNo('its value differs by language'),
    'vary-by-segment': yesNo('its value differs by segment'),
    type: Flags.string({ summary: 'its data type', helpValue: '<data type>' }),
    'member-can-view': yesNo('member types: the member sees it on their profile'),
    'member-can-edit': yesNo('member types: the member may change it on their profile'),
    sensitive: yesNo('member types: hidden from users who may not see sensitive data'),
    ...editFlags,
  }
  static override spec = editSpec

  async run() {
    const { args, flags } = await this.parse(TypesPropertyUpdate)
    const found = await findType(args.type, flags.kind)
    const blank = (value: string | undefined) => (value === undefined ? undefined : value || null)
    const result = updateProperty(found.type, args.property, {
      name: flags.name,
      description: flags.description,
      mandatory: flags.mandatory,
      regex: blank(flags.regex),
      regexMessage: blank(flags['regex-message']),
      variesByCulture: flags['vary-by-culture'],
      variesBySegment: flags['vary-by-segment'],
      dataType: flags.type,
      memberCanView: flags['member-can-view'],
      memberCanEdit: flags['member-can-edit'],
      sensitive: flags.sensitive,
    })
    const said = (flag: boolean | undefined, yes: string, no: string) =>
      flag === undefined ? [] : [`  ${flag ? yes : no}`]
    const change = [
      `"${args.property}" on "${found.type.name}":`,
      ...(flags.name ? [`  named "${flags.name}"`] : []),
      ...(flags.description !== undefined
        ? [flags.description ? '  described anew' : '  no description']
        : []),
      ...said(flags.mandatory, 'mandatory', 'not mandatory'),
      ...(flags.regex !== undefined
        ? [flags.regex ? `  must match ${flags.regex}` : '  no validation']
        : []),
      ...said(flags['vary-by-culture'], 'varies by language', 'does not vary by language'),
      ...said(flags['vary-by-segment'], 'varies by segment', 'does not vary by segment'),
      ...(flags.type ? [`  a ${flags.type}`] : []),
      ...said(flags['member-can-view'], 'seen by the member', 'not seen by the member'),
      ...said(flags['member-can-edit'], 'changed by the member', 'not changed by the member'),
      ...said(flags.sensitive, 'sensitive', 'not sensitive'),
    ]
    return commitTypeEdit(this, found, result, change, flags)
  }
}
