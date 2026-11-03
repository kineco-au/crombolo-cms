import { PERMISSION_NAMES } from '@crombolo/core'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'

/** Every permission a group can hold, by its plain name (story 254). */
export default class UsersGroupsPermissions extends BaseCommand {
  static override summary = 'the permissions a user group can hold, and what each allows'
  static override description =
    '`users groups new` and `update` take these names after --permission. Each is area:action, since pages, Library items, media and forms each have their own.'
  static override examples = [
    '<%= config.bin %> users groups permissions',
    '<%= config.bin %> users groups permissions --verbs',
  ]
  static override flags = {
    verbs: Flags.boolean({ summary: 'show the name each is kept under as well' }),
  }
  static override spec = {
    effects: 'read_only',
    cardinality: 'bounded',
    outputFields: [
      {
        name: 'items',
        type: 'array',
        items: {
          type: 'object',
          fields: [
            { name: 'name', type: 'string' },
            { name: 'area', type: 'string' },
            { name: 'verb', type: 'string' },
            { name: 'says', type: 'string' },
          ],
        },
      },
    ],
    errors: [],
  } as const

  async run() {
    const { flags } = await this.parse(UsersGroupsPermissions)
    let area = ''
    for (const p of PERMISSION_NAMES) {
      if (p.area !== area) {
        this.say(`${area ? '\n' : ''}${p.area}`)
        area = p.area
      }
      this.say(`  ${p.name.padEnd(32)} ${p.says}${flags.verbs ? `   (${p.verb})` : ''}`)
    }
    return { items: PERMISSION_NAMES.map((p) => ({ ...p })) }
  }
}
