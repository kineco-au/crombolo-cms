import { Args } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { removeProfile } from '../../profiles/profiles-file.ts'

export default class ProfileRemove extends BaseCommand {
  static override summary = 'forget a profile; removing one that is not there changes nothing'
  static override description =
    'Only its table goes: the rest of the file is left as it was. A sign-in it used stays until `crombolo logout`.'
  static override args = {
    name: Args.string({ required: true, description: "the profile's name" }),
  }
  static override access = 'none' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: [
      { name: 'name', type: 'string' },
      { name: 'changed', type: 'boolean' },
    ],
    errors: ['usage'],
  } as const

  async run() {
    const { args } = await this.parse(ProfileRemove)
    const changed = removeProfile(args.name)
    this.say(
      changed
        ? `  removed  ${args.name}`
        : `  There is no profile "${args.name}"; nothing changed.`,
    )
    return { name: args.name, changed }
  }
}
