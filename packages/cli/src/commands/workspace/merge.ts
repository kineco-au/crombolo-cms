import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base.ts'
import { workspaceNamed } from '../../support/work-site.ts'
import { onSite, siteFlags, whereField } from '../../support/workspace-commands.ts'

export default class WorkspaceMerge extends BaseCommand {
  static override summary =
    'merge workspaces into Shared, all or none: a dry run says what it would do and runs the checks'
  static override examples = [
    '<%= config.bin %> workspace merge "Spring sale" --dry-run',
    '<%= config.bin %> workspace merge "Spring sale" --yes --accept-lossy property-retired',
    '<%= config.bin %> workspace merge "Spring sale,Footer" --yes',
  ]
  static override args = {
    workspaces: Args.string({
      required: true,
      description: 'one or more, by name or key, separated by commas',
    }),
  }
  static override flags = {
    ...siteFlags,
    'dry-run': Flags.boolean({ summary: 'say what it would do, changing nothing' }),
    yes: Flags.boolean({ summary: 'merge, rather than only saying what would' }),
    'accept-lossy': Flags.string({
      summary: 'a change that loses data, removes or renames, by its id or kind; repeatable',
      multiple: true,
      helpValue: '<item>',
    }),
  }
  static override access = 'site' as const
  static override section = 'content' as const
  static override spec = {
    effects: 'non_idempotent',
    cardinality: 'single',
    confirmationBypassArg: '--yes',
    outputFields: [
      whereField,
      { name: 'merged', type: 'boolean' },
      { name: 'blockers', type: 'array', items: { type: 'string' } },
      { name: 'changeId', type: 'string', nullable: true },
    ],
    outcomes: ['conflicts_found', 'lossy_unaccepted'],
    errors: ['usage', 'auth', 'not_found', 'refused', 'confirmation_required'],
  } as const

  async run() {
    const { args, flags } = await this.parse(WorkspaceMerge)
    const names = args.workspaces
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    const first = names.length === 1 ? names[0] : undefined
    return onSite(this, flags, first, async (site, chosen) => {
      const keys = chosen
        ? [chosen.key]
        : await Promise.all(names.map(async (n) => (await workspaceNamed(site, n)).key))
      if (!chosen) this.say(`  merging ${names.join(', ')} as one`)
      const rehearse = flags['dry-run'] || !flags.yes
      const body = { accept: flags['accept-lossy'] ?? [], rehearse, workspaces: keys }
      const response = await site.call(
        'POST',
        keys.length === 1 ? `workspaces/${keys[0]}/merge` : 'workspaces/merge',
        body,
      )
      const answer = (await response.json().catch(() => ({}))) as {
        items?: string[]
        blockers?: string[]
        title?: string
        changeId?: string
        merged?: unknown[]
      }
      if (!response.ok) {
        const blockers = answer.items ??
          answer.blockers ?? [answer.title ?? `refused (${response.status})`]
        for (const b of blockers) this.say(`  ${b}`)
        this.outcome = blockers.some((b) => /accept/i.test(b))
          ? 'lossy_unaccepted'
          : 'conflicts_found'
        this.changedNothing = true
        return { merged: false, blockers, changeId: null }
      }
      if (rehearse) {
        this.say(`  it would merge${flags.yes ? '' : ': --yes merges it'}`)
        this.changedNothing = true
        return { merged: false, blockers: [], changeId: null }
      }
      this.say('  merged')
      return { merged: true, blockers: [], changeId: answer.changeId ?? null }
    })
  }
}
