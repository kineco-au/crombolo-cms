import { SECTION_ALIASES, SECTION_NAMES } from '@crombolo/core'
import { BaseCommand } from '../../../base.ts'

/** The sections a group may open, and what each holds (story 254). */
export default class UsersGroupsSections extends BaseCommand {
  static override summary = 'the sections a user group may open, and what each holds'
  static override description =
    '`users groups new` and `update` take these names after --section. A section a bundle adds is named by its own alias, such as Acme.Section.Reports.'
  static override examples = ['<%= config.bin %> users groups sections']
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
            { name: 'says', type: 'string' },
          ],
        },
      },
    ],
    errors: [],
  } as const

  async run() {
    await this.parse(this.ctor)
    const items = SECTION_NAMES.map((s) => ({
      name: s.name,
      says: s.says,
      alias: SECTION_ALIASES[s.name],
    }))
    for (const s of items) this.say(`  ${s.name.padEnd(14)} ${s.says}`)
    this.say('\nA section a bundle adds is named by its own alias, such as Acme.Section.Reports.')
    return { items }
  }
}
