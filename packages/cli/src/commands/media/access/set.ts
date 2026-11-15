import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../../base.ts'
import { accessFields, withMediaLibrary } from '../../../support/media-library.ts'
import { profileFlags } from '../../../support/remote.ts'

/** Who may see and change a media folder or item, set as its Permissions dialog sets it (story 355). */
export default class MediaAccessSet extends BaseCommand {
  static override summary = 'set who can see and change a media folder or item'
  static override description = [
    'A group is a member group, named as the back office lists it. Each --group given takes the one level: --read lets its members see it, so only the groups chosen can; --change lets them see and change it; --none takes both away.',
    '--inherit follows the folder above again, and takes nothing else. --no-inherit gives it settings of its own, starting from the folder above’s. Any other change gives it its own settings too.',
    'Chosen members, member uploads and the settings for new files are kept as they are: the Permissions dialog sets those.',
  ].join('\n\n')
  static override examples = [
    '<%= config.bin %> media access set /Members --group Gold --group Silver --read',
    '<%= config.bin %> media access set /Members --group Editors --change',
    '<%= config.bin %> media access set /Members/Old --inherit',
    '<%= config.bin %> media access set /Press --anyone',
  ]
  static override args = {
    item: Args.string({ required: true, description: 'the folder or item: a path or a uuid' }),
  }
  static override flags = {
    anyone: Flags.boolean({
      summary: 'anyone with the link can see it',
      exclusive: ['back-office-only'],
    }),
    'back-office-only': Flags.boolean({ summary: 'only back-office users can see it' }),
    group: Flags.string({
      summary: 'a member group, by name; repeat it for more',
      helpValue: '<name>',
      multiple: true,
    }),
    read: Flags.boolean({
      summary: "the groups' members can see it",
      exclusive: ['change', 'none'],
    }),
    change: Flags.boolean({
      summary: "the groups' members can see and change it",
      exclusive: ['none'],
    }),
    none: Flags.boolean({ summary: "the groups' members can neither see nor change it" }),
    inherit: Flags.boolean({
      summary: 'follow the folder above; --no-inherit for settings of its own',
      allowNo: true,
    }),
    ...profileFlags,
  }
  static override audit = {
    category: 'media',
    action: 'SetPermissions',
    entityType: 'MediaAccess',
  } as const
  static override access = 'site' as const
  static override section = 'media' as const
  static override spec = {
    effects: 'idempotent',
    cardinality: 'single',
    outputFields: accessFields,
    errors: ['not_found', 'refused', 'usage', 'unavailable'],
  } as const

  async run() {
    const { args, flags } = await this.parse(MediaAccessSet)
    const groups = flags.group ?? []
    const level = flags.read ? 'read' : flags.change ? 'change' : flags.none ? 'none' : undefined
    const see = flags.anyone ? 'anyone' : flags['back-office-only'] ? 'back-office' : undefined
    if (groups.length > 0 && !level)
      this.fail('usage', 'Say what the groups may do: --read, --change or --none.')
    if (groups.length === 0 && level)
      this.fail('usage', `--${level} is for the groups --group names.`)
    if (flags.inherit === true && (see || groups.length > 0))
      this.fail('usage', '--inherit follows the folder above, and takes nothing else.')
    if (see && level === 'read')
      this.fail(
        'usage',
        `--read chooses who can see it, so it cannot go with --${see === 'anyone' ? 'anyone' : 'back-office-only'}.`,
      )
    if (!see && groups.length === 0 && flags.inherit === undefined)
      this.fail(
        'usage',
        'Say what to change: --anyone, --back-office-only, --group with --read, --change or --none, --inherit or --no-inherit.',
      )
    return withMediaLibrary(flags, 'media-access', async (site) => {
      const view = await site.setAccess(args.item, {
        ...(see ? { see } : {}),
        ...(groups.length > 0 ? { groups, level } : {}),
        ...(flags.inherit !== undefined ? { inherit: flags.inherit } : {}),
      })
      if (site.hosted) this.auditedElsewhere = true
      this.auditKey = view.key
      this.say(`${view.path}`)
      this.say(`  ${view.summary}`)
      return view
    })
  }
}
